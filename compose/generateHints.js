#!/usr/bin/env node
/* global __dirname */
const fs = require('fs');
const path = require('path');

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

        obj.properties[prop].options.show_opt_in = true;

        if (obj.properties[prop].type) {
            if (obj.properties[prop].type === "object") {
                obj.properties[prop].options.disable_properties = true;
                obj.properties[prop].options.disable_edit_json = true;
                obj.properties[prop]._format = "grid";
                obj.properties[prop].options.collapsed = true;
                _decorateObject(obj.properties[prop]);
            } else if (obj.properties[prop].type === "array") {
                obj.properties[prop].options.disable_properties = true;
                obj.properties[prop].options.disable_edit_json = true;
                obj.properties[prop].items._format = "wb-object";
                if (obj.properties[prop].items.properties) {
                    _decorateObject(obj.properties[prop].items.properties);
                }
                obj.properties[prop].options.collapsed = true;
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

        // take the missing properties from the additional
        const propertyHolder = additional[platform] ? additional[platform] : {};

        {
            const refs = _findRefs(platforms[platform].anyOf);
            for (const defI in refs) {
                for (const prop in haSchema.definitions[refs[defI]].properties) {
                    propertyHolder[prop] = haSchema.definitions[refs[defI]].properties[prop];

                    if (propertyHolder[prop].description) {
                        propertyHolder[prop].description =
                                propertyHolder[prop].description.replace(/\nhttps?:\/\/\S+/g, "");
                    }
                }
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

        typedModOneOfs.push(ret);
    }

    const newDefs = {};

    // resolve the $refs
    _resolveAllRefs(JSON.stringify(typedModOneOfs, null, 4), haSchema, newDefs);

    // write two hint files
    fs.writeFileSync(path.resolve(__dirname, 'typedModOneOf.json'), JSON.stringify(typedModOneOfs, null, 4), 'utf8');

    fs.writeFileSync(path.resolve(__dirname, 'typedModDefs.json'), JSON.stringify(newDefs, null, 4), 'utf8');


} catch (err2) {
    console.error('Error parsing HA schema:', err2);
}

