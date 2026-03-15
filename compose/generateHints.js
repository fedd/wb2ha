#!/usr/bin/env node
/* global __dirname */
const fs = require('fs');
const path = require('path');

const unwanted = [
    "unique_id",
    "device",
    "name",
    "object_id",
    "qos",
    "retain"
].sort();

function _findRefs(anyofArr) {
    const ret = [];
    for (const i in anyofArr) {
        if (anyofArr[i]["$ref"]) {
            ret.push(anyofArr[i]["$ref"].slice("#/definitions/".length));
        }
    }
    return ret;
}

function _decorateObject(obj) {
    for (const prop in obj.properties) {

        if (!obj.properties[prop].options) {
            obj.properties[prop].options = {};
        }

        let our = obj.properties[prop];
        if (prop !== "schema") {

            if (our.type !== "string" || our.enum) {
                
                obj.properties[prop] = {
                    options: our.options,
                    oneOf: [
                        our,
                        {
                            title: our.type + " {var}",
                            type: "string",
                            pattern: "^\\{\\S+\\}$"
                        }
                    ]
                }
                delete our.options;
                if (our.description) {
                    obj.properties[prop].description = our.description;
                    delete our.description;
                }

            }

            obj.properties[prop].options.show_opt_in = true;

        } else {
            our.options.hidden = true;
        }

        if (our.type) {
            if (our.type === "object") {
                if(!our.options){
                    our.options = {};
                }
                our.options.disable_properties = false;
                our.options.disable_edit_json = true;
                our._format = "grid";
                our.options.collapsed = true;
                _decorateObject(our);
            } else if (our.type === "array") {
                if(!our.options){
                    our.options = {};
                }
                our.options.disable_properties = true;
                our.options.disable_edit_json = true;
                our.items._format = "wb-object";
                if (our.items.properties) {
                    _decorateObject(our.items.properties);
                }
                our.options.collapsed = true;
            }
        }

    }
}

function _resolveAllRefs(currentJson, srcSchema, newDefs) {
    const refs = currentJson.matchAll(/\"\$ref\":\s*\"\#\/definitions\/(.*)\"/g);
    for (const ref of refs) {
        if (!newDefs[ref[1]]) {
            newDefs[ref[1]] = srcSchema.definitions[ref[1]];
            _resolveAllRefs(JSON.stringify(newDefs[ref[1]], null, 4), srcSchema, newDefs);
        }
    }
}


try {
    // extract mqtt schema
    const haSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'ha.schema.json'), 'utf8'));

    const typedModOneOfs = [];

    const additional = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'typedMod.additional.json'), 'utf8'));


    const platforms = haSchema.definitions[
            _findRefs(haSchema.definitions.ConfigurationRoot.properties.mqtt.anyOf)[0] //Item_28
    ].properties;

    // add totally missing platforms
    for (const platform in additional) {
        if (!platforms[platform]) {
            platforms[platform] = {
                "type": "object"
            };
        }
    }

    for (const platform in platforms) {

        const refs = _findRefs(platforms[platform].anyOf);

        for (const defI in refs) {

            // take the missing properties from the additional
            const propertyHolder = additional[platform] ? additional[platform] : {};

            for (const prop in haSchema.definitions[refs[defI]].properties) {

                if (unwanted.includes(prop)) {
                    continue;
                }

                if (!propertyHolder[prop]) {
                    propertyHolder[prop] = haSchema.definitions[refs[defI]].properties[prop];
                }

                if (propertyHolder[prop].description) {
                    propertyHolder[prop].description =
                            propertyHolder[prop].description.replace(/\nhttps?:\/\/\S+/g, "");
                }
            }

            const ret = {
                type: "object",
                title: platform,
                properties: {},
                additionalProperties: false,
                "default": {}
            };
            ret["default"][platform] = {};
            ret.properties[platform] = {
                title: " ",
                options: {
                    "disable_properties": true,
                    "disable_edit_json": true,
                    "disable_collapse": false,
                    "collapsed": true
                },
                type: "object",
                description: platforms[platform].description,
                properties: propertyHolder,
                _format: "grid"
            };

            _decorateObject(ret.properties[platform]);

            // multiple schemas
            if (ret.properties[platform].properties.schema) {

                // TODO: find the modern json schema, until then rename the light "default" schema to "basic"
                if (platform === "light" && ret.properties[platform].properties.schema.const === "default") {
                    ret.properties[platform].properties.schema.const = "basic";
                }

                ret.properties[platform]["default"] = {
                    schema: ret.properties[platform].properties.schema.const
                };
                ret["default"][platform].schema = ret.properties[platform].properties.schema.const;
                ret.title = platform + " " + ret["default"][platform].schema;
                ret.properties[platform].properties.schema.enum = [ret.properties[platform].properties.schema.const];
                delete ret.properties[platform].properties.schema.const;
            }

            typedModOneOfs.push(ret);
        }


    }

    const newDefs = {};

    // resolve the $refs
    _resolveAllRefs(JSON.stringify(typedModOneOfs, null, 4), haSchema, newDefs);

    for (const def in newDefs) {
        if (newDefs[def].properties) {
            _decorateObject(newDefs[def]);
        }
    }

    // write two hint files
    fs.writeFileSync(path.resolve(__dirname, 'typedModOneOf.json'), JSON.stringify(typedModOneOfs, null, 4), 'utf8');

    fs.writeFileSync(path.resolve(__dirname, 'typedModDefs.json'), JSON.stringify(newDefs, null, 4), 'utf8');


} catch (err2) {
    console.error('Error parsing HA schema:', err2);
}

