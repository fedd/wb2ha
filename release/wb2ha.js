/* global log, SCHEMA, CONFIG */

// Convert Wirenboard metas to Home Assistant MQTT Discovery configs.
// A Wirenboard rule.
// Author: fedd@vsetec.com

var SCHEMAFILENAME = "/usr/share/wb-mqtt-confed/schemas/wb2ha.schema.json";

var debugging = false;

var devices = {};

var devicesUpdatedAt = 0;
var stillWritingFile = false;

// create the schema file if absent, then run
runShellCommand("test -f " + SCHEMAFILENAME, {
    exitCallback: function (exitCode) {
        if (exitCode === 0) {
            SCHEMA = readConfig(SCHEMAFILENAME);
            _createConfigAndRun();
        } else {
            // create the default schema
            spawn("tee", [SCHEMAFILENAME], {
                input: JSON.stringify(SCHEMA, null, 4),
                exitCallback: function () {
                    log.warning("wb2ha: created the default schema {}", SCHEMAFILENAME);
                    setTimeout(_createConfigAndRun, 2000); // wait a sec, then proceed
                }
            });
        }
    }
});

// creating the main config file if it's absent, then run
function _createConfigAndRun() {
    runShellCommand("test -f " + SCHEMA.configFile.path, {
        exitCallback: function (exitCode) {
            if (exitCode === 0) {
                _startTracking();
            } else {

                spawn("cat", ["/var/lib/wirenboard/short_sn.conf"], {
                    captureOutput: true,
                    exitCallback: function exitCallback(exitCode, output) {
                        if (exitCode !== 0) {
                            log.error("wb2ha: no shortSN in /var/lib/wirenboard/short_sn.conf");
                        } else {
                            CONFIG.wbId = output.trim();
                            // create default config
                            spawn("tee", [SCHEMA.configFile.path], {
                                //default config with basic WB types and units
                                input: JSON.stringify(CONFIG, null, 4),
                                exitCallback: function () {
                                    log.warning("wb2ha: created the default config file {}", SCHEMA.configFile.path);
                                    setTimeout(_startTracking, 2000); // wait a sec, then start the main process
                                }
                            });
                        }
                    }
                });

            }
        }
    });
}

function _updateSchema() {
    if (devicesUpdatedAt > 0) {
        // wait for more
        devicesUpdatedAt = Date.now();
        return;
    } else {
        devicesUpdatedAt = Date.now();
        var watcher = setInterval(function () {
            if (stillWritingFile) { //wait even more
                return;
            }
            if (Date.now() - devicesUpdatedAt > 2000) { // 2 seconds passed since last update

                clearInterval(watcher);
                devicesUpdatedAt = 0; // another watcher can be started if a new update arrives

                // clear the devices in schema
                var oldDeviceProperties = SCHEMA.properties.lists.properties.devices.properties;
                SCHEMA.properties.lists.properties.devices.properties = {};

                var collectedTranslations = {};
                // take the devices snapshot and populate the devices in schema
                var devIds = Object.keys(devices);
                devIds.sort();
                for (var i in devIds) {
                    // add device
                    SCHEMA.properties.
                            lists.
                            properties.
                            devices.
                            properties[devIds[i]] = {
                        "title": "Device " + devIds[i],
                        "propertyOrder": i,
                        "$ref": "#/definitions/device",
                        "properties": {
                            "controls": {
                                "properties": {}
                            }
                        }
                    };

                    // device title translations
                    if (debugging) {
                        log("Looking into device {}: {}", devIds[i], JSON.stringify(devices[devIds[i]]));
                    }
                    if (devices[devIds[i]].meta && devices[devIds[i]].meta.title) {
                        var titles = devices[devIds[i]].meta.title;
                        if (typeof titles === 'string' || titles instanceof String) {
                            SCHEMA.properties.
                                    lists.
                                    properties.
                                    devices.
                                    properties[devIds[i]].title = devIds[i] === titles ? devIds[i] : devIds[i] + " (" + titles + ")";
                        } else {
                            for (var lang in titles) {
                                if (!SCHEMA.translations[lang]) {
                                    SCHEMA.translations[lang] = {};
                                }
                                collectedTranslations[SCHEMA.properties.
                                        lists.
                                        properties.
                                        devices.
                                        properties[devIds[i]].title] = devIds[i];
                                SCHEMA.translations[lang][SCHEMA.properties.
                                        lists.
                                        properties.
                                        devices.
                                        properties[devIds[i]].title] =
                                        devIds[i] === titles[lang] ? devIds[i] : devIds[i] + " (" + titles[lang] + ")";
                            }
                        }
                    } else {
                        SCHEMA.properties.
                                lists.
                                properties.
                                devices.
                                properties[devIds[i]].title = devIds[i];
                    }

                    //add controls
                    var ctrIds = Object.keys(devices[devIds[i]].controls);
                    ctrIds.sort();
                    for (var j in ctrIds) {
                        SCHEMA.properties.
                                lists.
                                properties.
                                devices.
                                properties[devIds[i]].
                                properties.
                                controls.
                                properties[ctrIds[j]] = {
                            "title": "Control " + devIds[i] + "_" + ctrIds[j],
                            "propertyOrder": j,
                            "$ref": "#/definitions/control"
                        };

                        // control title translations
                        if (devices[devIds[i]].controls[ctrIds[j]].meta &&
                                devices[devIds[i]].controls[ctrIds[j]].meta.title) {
                            var titles = devices[devIds[i]].controls[ctrIds[j]].meta.title;
                            if (typeof titles === 'string' || titles instanceof String) {
                                SCHEMA.properties.
                                        lists.
                                        properties.
                                        devices.
                                        properties[devIds[i]].
                                        properties.
                                        controls.
                                        properties[ctrIds[j]].title = ctrIds[j] === titles ? ctrIds[j] : ctrIds[j] + " (" + titles + ")";
                            } else {
                                for (var lang in titles) {
                                    if (!SCHEMA.translations[lang]) {
                                        SCHEMA.translations[lang] = {};
                                    }
                                    collectedTranslations[SCHEMA.properties.
                                            lists.
                                            properties.
                                            devices.
                                            properties[devIds[i]].
                                            properties.
                                            controls.
                                            properties[ctrIds[j]].title] = ctrIds[j];
                                    SCHEMA.translations[lang][SCHEMA.properties.
                                            lists.
                                            properties.
                                            devices.
                                            properties[devIds[i]].
                                            properties.
                                            controls.
                                            properties[ctrIds[j]].title] =
                                            ctrIds[j] === titles[lang] ? ctrIds[j] : ctrIds[j] + " (" + titles[lang] + ")";
                                }
                            }
                        } else {
                            SCHEMA.properties.
                                    lists.
                                    properties.
                                    devices.
                                    properties[devIds[i]].
                                    properties.
                                    controls.
                                    properties[ctrIds[j]].title = ctrIds[j];
                        }
                    }
                }

                // put ids instead of the missing translations
                for (var title in collectedTranslations) {
                    for (var lang in SCHEMA.translations) {
                        if (!SCHEMA.translations[lang][title]) {
                            SCHEMA.translations[lang][title] = collectedTranslations[title];
                        }
                    }
                }

                if (!_deepEquals(SCHEMA.properties.lists.properties.devices.properties, oldDeviceProperties)) {
                    // any changes?
                    // better take time to deep compare then write a file

                    stillWritingFile = true;
                    // now write the actual file. asynchronous!
                    spawn("tee", [SCHEMAFILENAME], {
                        input: JSON.stringify(SCHEMA, null, 4),
                        exitCallback: function () {
                            log.warning("wb2ha: updated the schema with new devices at {}", SCHEMAFILENAME);
                            stillWritingFile = false;
                        }
                    });

                }

            }
        }, 2000);
    }
}

function _startTracking() {

    _loadConfig();

    var inotifyIsWorking = false;
    // track config files change
    setInterval(function () {
        if (!inotifyIsWorking) {
            inotifyIsWorking = true;
            runShellCommand("inotifywait -e modify " + SCHEMA.configFile.path, {
                exitCallback: function () {

                    setTimeout(function () {
                        log.warning("wb2ha: config changed, reloading");

                        _loadConfig();

                        for (var deviceId in devices) { // devices object is kept updated by trackMqtt
                            for (var controlId in devices[deviceId].controls) {
                                if (devices[deviceId].controls[controlId].topic) {
                                    log("wb2ha: UNpublishing control {} from {} before reprocessing", controlId,
                                            devices[deviceId].controls[controlId].topic);
                                    publish(devices[deviceId].controls[controlId].topic, "", 2, true);
                                    delete devices[deviceId].controls[controlId].topic;
                                }
                                // prepare to reprocess
                                devices[deviceId].controls[controlId].processed = false;
                                delete devices[deviceId].controls[controlId].type;
                                delete devices[deviceId].controls[controlId].name;

                                // reprocess
                                _process(deviceId, controlId);
                            }
                        }

                        inotifyIsWorking = false; // restart listening

                    }, 1000 * 2); // wait a sec

                }
            });
        }
    }, 1000 * 30);  // rerun the config file watcher

    // track devices
    trackMqtt("/devices/+/meta", function (message) {
        var stripped = message.topic.slice("/devices/".length);
        var deviceId = stripped.slice(stripped, stripped.indexOf("/"));

        if (message.value.length === 0) {
            return;
        }

        if (!devices[deviceId]) {
            devices[deviceId] = {
                id: deviceId,
                idSmall: deviceId.replace(/[^A-Za-z0-9-]/g, "_").toLowerCase(),
                controls: {}
            };
        }

        devices[deviceId].meta = JSON.parse(message.value);

        // process the controls found so far
        for (var controlId in devices[deviceId].controls) {
            _process(deviceId, controlId);
        }
    });

    // track controls
    trackMqtt("/devices/+/controls/+/meta", function (message) {
        var stripped = message.topic.slice("/devices/".length);
        var deviceId = stripped.slice(stripped, stripped.indexOf("/"));
        stripped = stripped.slice(deviceId.length + "/controls/".length);
        var controlId = stripped.slice(stripped, stripped.indexOf("/"));

        if (message.value.length === 0) {
            if (devices[deviceId] && devices[deviceId].controls[controlId]) {
                if (devices[deviceId].controls[controlId].topic) {
                    log("wb2ha: UNpublishing control {} from {}", controlId,
                            devices[deviceId].controls[controlId].topic);
                    publish(devices[deviceId].controls[controlId].topic, "", 2, true);
                }
                //devices[deviceId].controls[controlId].processed = true;

                delete devices[deviceId].controls[controlId]; // radically
                if (Object.keys(devices[deviceId]).length === 0) {
                    delete devices[deviceId];
                }

                _updateSchema();
            }
            return;
        }

        if (!devices[deviceId]) {
            devices[deviceId] = {
                id: deviceId,
                idSmall: deviceId.replace(/[^A-Za-z0-9-]/g, "_").toLowerCase(),
                controls: {}
            };
        }

        devices[deviceId].controls[controlId] = {
            id: controlId,
            idSmall: controlId.replace(/[^A-Za-z0-9-]/g, "_").toLowerCase(),
            deviceId: deviceId,
            meta: JSON.parse(message.value),
            "var": {},
            processed: false
        };

        _updateSchema();

        // have encountered a device
        if (devices[deviceId].meta) {
            _process(deviceId, controlId);
        }
    });

}

function _process(deviceId, controlId) {

    var device = devices[deviceId];
    var control = device.controls[controlId];

    if (control.processed) {
        return;
    }
    control.processed = true;

    // tangled logic
    if ((CONFIG.all && (!CONFIG.lists.devices[deviceId] || !CONFIG.lists.devices[deviceId].reverse))
            ||
            (!CONFIG.all
                    &&
                    CONFIG.lists.devices[deviceId]
                    &&
                    (CONFIG.lists.devices[deviceId].reverse || CONFIG.lists.devices[deviceId].controls[controlId]))) {
        // do not return, continue to process
    } else {
        debug("wb2ha: skipping device {} control {} as per config", deviceId, controlId);
        return;
    }

    // collect all modifiers into one modifier object
    // initialise it with common values
    control.discovery = {
        device: {
            identifiers: [device.idSmall + "_" + CONFIG.wbId],
            manufacturer: "WirenBoard",
            name: deviceId
        },
        origin: {
            "name": "wb2ha",
            "sw": "0.3",
            "url": "https://github.com/fedd/wb2ha"
        },
        availability_mode: "latest",
        enabled_by_default: true,
        availability: [{
                topic: "/devices/" + deviceId + "/controls/" + controlId,
                value_template: "{{ False if value == '' else True }}",
                payload_not_available: false,
                payload_available: true
            }, {
                topic: "/devices/" + deviceId + "/controls/" + controlId + "/meta",
                value_template: "{{ False if value == '' else True }}",
                payload_not_available: false,
                payload_available: true
            }, {
                topic: "/devices/" + deviceId + "/controls/" + controlId + "/error",
                value_template: "{{ True if value == '' else False }}",
                payload_not_available: false,
                payload_available: true
            }],
        state_topic: "/devices/" + deviceId + "/controls/" + controlId,
        name: controlId,
        unique_id: device.idSmall + "_" + CONFIG.wbId + "_" + control.idSmall
    };

    if (device.meta.driver) {
        control.discovery.device.model = device.meta.driver;
    }

    if (control.meta.readonly === false) {
        control.discovery.command_topic = "/devices/" + deviceId + "/controls/" + controlId + "/on";
    }
    if (control.meta.hasOwnProperty("min")) {
        control.discovery.min = control.meta.min;
    }
    if (control.meta.hasOwnProperty("max")) {
        control.discovery.max = control.meta.max;
    }

    // deduce mods from units of measurement
    if (control.meta.units) {
        control.discovery.unit_of_measurement = control.meta.units;
        _copyTypeModRW(control, CONFIG.lists.units[control.meta.units]);
    }
    // deduce mods from type
    if (control.meta.type) {
        _copyTypeModRW(control, CONFIG.lists.controlTypes[control.meta.type]);
    }

    // lastly, take our named mods and then our own mod which will overwrite everything
    if (CONFIG.lists.devices[deviceId] &&
            CONFIG.lists.devices[deviceId].controls &&
            CONFIG.lists.devices[deviceId].controls[controlId])
        _copyTypeModRW(control, CONFIG.lists.devices[deviceId].controls[controlId], {});

    // enum options
    if (control.meta.enum) {
        control.discovery.options = [];
        for (var item in control.meta.enum) {
            control.discovery.options.push(item);
        }
        if (!control.discovery.device_class) {
            control.discovery.device_class = "enum";
        }
    }

    // replace the deprecated "object_id"
    control.discovery.default_entity_id = control.type + "." +
            control.discovery.unique_id;

    control.topic =
            CONFIG.haroot + "/" +
            control.type + "/" +
            CONFIG.node + CONFIG.wbId + "/" +
            device.idSmall + "_" +
            control.idSmall + "/config";

    // replace all {var}, {device.id} and {control.meta.enum...} placeholders
    _poorMansTemplater(control, device);

    log("wb2ha: publishing control {} to {}", control.id, control.topic);
    if (debugging) {
        log.warning("{} {}", control.topic, JSON.stringify(control.discovery));
    } else {
        publish(control.topic, JSON.stringify(control.discovery), 2, true);
    }

}

function _stringOrArrayToMods(obj) {
    if (typeof obj === 'string' || obj instanceof String) {
        return {
            namedModifiers: [obj]
        };
    }
    if (typeof obj === 'array' || obj instanceof Array) {
        return {
            namedModifiers: obj
        };
    }
    return obj;
}

function _arrayOrNullToMap(obj) {
    if (!obj) {
        return {};
    }
    if (typeof obj === 'array' || obj instanceof Array) {
        var ret = {};
        for (var i in obj) {
            ret[obj[i].code] = obj[i].value;
        }
        return ret;
    } else {
        return obj;
    }
}

function _loadConfig() {
    CONFIG = readConfig(SCHEMA.configFile.path);

    // convert those json-editor's silly arrays of objects to normal keyvalue maps
    CONFIG.lists.namedModifiers = _arrayOrNullToMap(CONFIG.lists.namedModifiers);
    CONFIG.lists.units = _arrayOrNullToMap(CONFIG.lists.units);
    CONFIG.lists.controlTypes = _arrayOrNullToMap(CONFIG.lists.controlTypes);

    if (debugging) {
        log.warning("{}", JSON.stringify(CONFIG));
    }

    log("wb2ha: loaded config file {}", SCHEMA.configFile.path);
}

function _copyTypeMod(dest, mod, src, includeNamedModifiers) {
    if (src.type) {
        dest.type = src.type;
    }
    if (src.name) {
        mod.name = src.name;
    }
    if (src.var) {
        if (!dest.var) {
            dest.var = {};
        }
        for (var mi in src.var) {
            dest.var[src.var[mi].code] = src.var[mi].value;
        }
    }
    if (includeNamedModifiers && src.namedModifiers) {
        if (!dest.namedModifiers) {
            dest.namedModifiers = [];
        }
        for (var mi in src.namedModifiers) {
            dest.namedModifiers.push(src.namedModifiers[mi]);
        }
    }
    if (src.mod) {
        if (typeof src.mod === 'array' || src.mod instanceof Array) {
            for (var mi in src.mod) {

                if (src.mod[mi].code === "availability") {

                    if (src.mod[mi].value !== 'array' && !src.mod[mi].value instanceof Array) {
                        src.mod[mi].value = [src.mod[mi].value];
                    }


                    if (typeof mod[src.mod[mi].code] === 'array' || mod[src.mod[mi].code] instanceof Array) {

                    } else if (mod[src.mod[mi].code] !== undefined) {
                        mod[src.mod[mi].code] = [
                            mod[src.mod[mi].code]
                        ];
                    } else {
                        mod[src.mod[mi].code] = [];
                    }

                    for (var ii in src.mod[mi].value) {
                        mod[src.mod[mi].code].push(src.mod[mi].value[ii]);
                    }

                } else {
                    mod[src.mod[mi].code] = src.mod[mi].value;
                }

            }
        } else {
            for (var type in src.mod) {
                dest.type = type;
                for (var prop in src.mod[type]) {

                    if (prop === "availability") {

                        if (src.mod[type][prop] !== 'array' && !src.mod[type][prop] instanceof Array) {
                            src.mod[type][prop] = [src.mod[type][prop]];
                        }


                        if (typeof mod[prop] === 'array' || mod[prop] instanceof Array) {
                        } else if (mod[prop] !== undefined) {
                            mod[prop] = [
                                mod[prop]
                            ];
                        } else {
                            mod[prop] = [];
                        }

                        for (var iii in src.mod[type][prop]) {
                            mod[prop].push(src.mod[type][prop][iii]);
                        }

                    } else {
                        mod[prop] = src.mod[type][prop];
                    }

                }
            }
        }
    }
    if (src.ifUnset) {
        if (typeof src.ifUnset === 'array' || src.ifUnset instanceof Array) {
            for (var mi in src.ifUnset) {
                if (mod[src.ifUnset[mi].code] === undefined) {
                    mod[src.ifUnset[mi].code] = src.ifUnset[mi].value;
                }
            }
        } else {
            for (var type in src.ifUnset) {
                if (dest.type === undefined) {
                    dest.type = type;
                }
                for (var prop in src.ifUnset[type]) {
                    if (mod[prop] === undefined) {
                        mod[prop] = src.ifUnset[type][prop];
                    }
                }
            }
        }
    }
}

function _copyTypeModRW(control, src, collectedNamedModifiers) {
    if (src) {
        var mod = control.discovery;
        if (collectedNamedModifiers && src.namedModifiers) { // supermodifiers
            for (var i in src.namedModifiers) {
                if (!collectedNamedModifiers[src.namedModifiers[i]]) { // avoid circular supermodifiers
                    collectedNamedModifiers[src.namedModifiers[i]] = true;
                    _copyTypeModRW(control, CONFIG.lists.namedModifiers[src.namedModifiers[i]], collectedNamedModifiers);
                }
            }
        }
        _copyTypeMod(control, mod, src, false);
        if (control.meta.readonly) {
            if (src.readonly) {
                _copyTypeMod(control, mod, src.readonly, false);
            }
        } else {
            if (src.writable) {
                _copyTypeMod(control, mod, src.writable, false);
            }
        }
    }
}

function _retriever(obj, str) {
    var pos = str.indexOf(".");
    if (pos <= 0) {
        return obj[str];
    } else {
        return _retriever(obj[str.slice(0, pos)], str.slice(pos + 1));
    }
}

function _traverse(obj, control, device) {
    for (var fld in obj) {
        if (typeof obj[fld] === 'string' || obj[fld] instanceof String) {
            //debug("Field {}, value: {}", fld, obj[fld]);
            if (obj[fld][0] === "{" && obj[fld][obj[fld].length - 1] === "}") { // the whole field is a replacer
                var ret = _returnValue(obj[fld], control, device);
                //debug("Result {}", ret);
                if (ret !== undefined) {
                    obj[fld] = ret;
                }
            }
        } else {
            _traverse(obj[fld], control, device);
        }
    }
}

function _returnValue(expression, control, device) {

    expression = expression.slice(1, -1); // strip curly brackets

    if (control.var[expression] !== undefined) {
        //debug("Found {} with {}",control.var[expression], expression);
        return control.var[expression];
    }

    var dotPos = expression.indexOf(".");
    if (dotPos <= 0) {
        //debug("no dot in expr {}", expression);
        return;
    }
    var variable = expression.slice(0, dotPos);
    var obj;
    switch (variable) {
        case "device":
            obj = device;
            break;
        case "control":
            obj = control;
            break;
        case "config":
            obj = CONFIG;
            break;
        case "devices":
            obj = devices;
            break;
        default:
            //return; illegal here, as well as continue
            break;
    }
    //debug("retrieve {} from {} which is {}", expression, variable, JSON.stringify(obj));
    if (!obj) {
        return;
    }
    //debug("retrieve {} from {} which is {}", expression, variable. JSON.stringify(obj));
    return _retriever(obj, expression.slice(variable.length + 1));

}

function _poorMansTemplater(control, device) {

    // traverse the discovery and replace pure field values
    _traverse(control.discovery, control, device);

    // now mass replace the rest
    var str = JSON.stringify(control.discovery);
    var placeholders = str.match(/\{[A-Za-z0-9_\.]+\}/g);
    if (!placeholders) {
        return;
    }
    var replacements = {};
    var occurences = {}; // no replaceAll method, so we'll count
    // find values for all placeholders
    //debug("Placeholders: {}", JSON.stringify(placeholders));

    for (var i in placeholders) {
        if (replacements[placeholders[i]] !== undefined) {
            occurences[placeholders[i]]++;
        } else {
            occurences[placeholders[i]] = 1;
            var p = placeholders[i].slice(1, -1); // strip curlies
            //debug("wb2ha: {} p={}", placeholders[i], p);
            var ret = _returnValue(placeholders[i], control, device);
            if (ret === undefined) {
                replacements[placeholders[i]] = placeholders[i]; // retain
            } else {
                replacements[placeholders[i]] = ret;
            }
            //debug("made {} for {}", replacements[placeholders[i]], placeholders[i]);
        }
    }

    // now replace all placeholders with those values
    //debug("replacements: {}", JSON.stringify(replacements));
    for (var p in replacements) {
        //debug("replacing p {} with {} {} times", p, replacements[p], occurences[p]);
        for (var i = 0; i < occurences[p]; i++) { // no replaceAll method :(
            str = str.replace(p, replacements[p]);
        }
    }

    //now make object from this text
    str = JSON.parse(str);
    // and copy all back to the discovery
    for (p in str) {
        control.discovery[p] = str[p]; // no idea if es5 has anything wiser
    }
}

function _deepEquals(obj1, obj2) {
    if (obj1 === obj2) {
        return true;
    } else if (__isObject(obj1) && __isObject(obj2)) {
        if (Object.keys(obj1).length !== Object.keys(obj2).length) {
            return false;
        }
        for (var prop in obj1) {
            if (!_deepEquals(obj1[prop], obj2[prop])) {
                return false;
            }
        }
        return true;
    } else if (typeof obj1 === 'array' && obj2 instanceof Array) {
        for (var prop in obj1) {
            if (!_deepEquals(obj1[prop], obj2[prop])) {
                return false;
            }
        }
        return true;
    } else {
        return false;
    }

    function __isObject(obj) {
        if (typeof obj === "object" && obj !== null) {
            return true;
        } else {
            return false;
        }
    }
}


var SCHEMA = {
    "$schema": "http://json-schema.org/draft-04/schema#",
    "title": "wb2ha Configuration",
    "description": "Configure WB devices to add to HA",
    "type": "object",
    "_format": "grid-strict",
    "options": {
        "show_opt_in_restore": true,
        "disable_edit_json": false,
        "disable_properties": true,
        "disable_collapse": true
    },
    "configFile": {
        "path": "/etc/wb-rules/wb2ha.config"
    },
    "properties": {
        "haroot": {
            "propertyOrder": 1,
            "type": "string",
            "title": "HA root",
            "default": "homeassistant",
            "options": {
                "grid_columns": 4
            }
        },
        "node": {
            "propertyOrder": 2,
            "type": "string",
            "title": "wb2ha node",
            "default": "w2h",
            "options": {
                "grid_columns": 4
            }
        },
        "wbId": {
            "propertyOrder": 3,
            "type": "string",
            "title": "WB id",
            "options": {
                "grid_columns": 4
            }
        },
        "all": {
            "propertyOrder": 4,
            "type": "boolean",
            "description": "Publish all devices and controls",
            "_format": "checkbox",
            "title": "All devices and controls",
            "options": {
                "grid_columns": 12
            }
        },
        "lists": {
            "propertyOrder": 100,
            "type": "object",
            "_format": "categories",
            "title": " ",
            "options": {
                "titleHidden": true,
                "show_opt_in_restore": true,
                "disable_edit_json": true,
                "disable_properties": true,
                "disable_collapse": true
            },
            "properties": {
                "devices": {
                    "propertyOrder": 10,
                    "title": "Devices",
                    "description": "Select devices and controls",
                    "options": {
                        "disable_edit_json": true,
                        "disable_properties": true,
                        "disable_collapse": true
                    },
                    "type": "object",
                    "properties": {
                        "system": {
                            "propertyOrder": 1,
                            "$ref": "#/definitions/device",
                            "properties": {
                                "controls": {
                                    "properties": {
                                        "Short SN": {
                                            "propertyOrder": 1,
                                            "$ref": "#/definitions/control"
                                        },
                                        "Current uptime": {
                                            "propertyOrder": 2,
                                            "$ref": "#/definitions/control"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "namedModifiers": {
                    "propertyOrder": 20,
                    "title": "Named Modifiers",
                    "description": "These are named sets of options",
                    "type": "array",
                    "_format": "grid",
                    "options": {
                        "disable_collapse": true
                    },
                    "items": {
                        "type": "object",
                        "title": "Named Modifier",
                        "headerTemplate": "{{ self.code }}",
                        "options": {
                            "collapsed": true
                        },
                        "properties": {
                            "code": {
                                "title": "Name",
                                "type": "string",
                                "description": "Name of the modifier",
                                "pattern": "^[a-zA-Z0-9_]+$"
                            },
                            "value": {
                                "title": "Definition",
                                "type": "object",
                                "_format": "grid",
                                "properties": {
                                    "mod": {
                                        "options": {
                                            "grid_columns": 8
                                        },
                                        "description": "Options for HA Discovery in Named Mod",
                                        "propertyOrder": 20,
                                        "$ref": "#/definitions/typedMod"
                                    },
                                    "namedModifiers": {
                                        "_format": "table",
                                        "options": {
                                            "grid_columns": 4,
                                            "show_opt_in": true,
                                            "disable_collapse": true
                                        },
                                        "description": "Other Named Modifiers",
                                        "propertyOrder": 30,
                                        "$ref": "#/definitions/namedModifierNames"
                                    }
                                }
                            }
                        }
                    }
                },
                "controlTypes": {
                    "propertyOrder": 30,
                    "title": "Control Types",
                    "description": "WB Control Types mods",
                    "type": "array",
                    "_format": "grid",
                    "options": {
                        "disable_collapse": true
                    },
                    "items": {
                        "type": "object",
                        "title": "Control Type",
                        "headerTemplate": "{{ self.code }}",
                        "options": {
                            "collapsed": true
                        },
                        "properties": {
                            "code": {
                                "title": "Name",
                                "type": "string",
                                "description": "WB control type name",
                                "pattern": "^[a-zA-Z0-9-_]+$"
                            },
                            "value": {
                                "$ref": "#/definitions/modify",
                                "description": "WB control modifiers",
                                "properties": {
                                    "readonly": {
                                        "options": {
                                            "grid_columns": 12,
                                            "show_opt_in": true
                                        },
                                        "title": "For readonly",
                                        "description": "Additional modifiers for readonly",
                                        "propertyOrder": 50,
                                        "$ref": "#/definitions/modify"
                                    },
                                    "writable": {
                                        "options": {
                                            "grid_columns": 12,
                                            "show_opt_in": true
                                        },
                                        "title": "For writable",
                                        "description": "Additional modifiers for writable",
                                        "propertyOrder": 60,
                                        "$ref": "#/definitions/modify"
                                    }
                                }
                            }
                        }
                    }
                },
                "units": {
                    "propertyOrder": 40,
                    "title": "Measurement Units",
                    "description": "WB Units mods",
                    "type": "array",
                    "_format": "grid",
                    "options": {
                        "disable_collapse": true
                    },
                    "items": {
                        "type": "object",
                        "title": "Measurement Unit",
                        "headerTemplate": "{{ self.code }}",
                        "options": {
                            "collapsed": true
                        },
                        "properties": {
                            "code": {
                                "title": "Abbreviation",
                                "type": "string",
                                "description": "WB unit name"
                            },
                            "value": {
                                "$ref": "#/definitions/modify",
                                "description": "WB unit modifiers",
                                "properties": {
                                    "readonly": {
                                        "options": {
                                            "grid_columns": 12,
                                            "show_opt_in": true
                                        },
                                        "title": "For readonly",
                                        "description": "Additional modifiers for readonly",
                                        "propertyOrder": 50,
                                        "$ref": "#/definitions/modify"
                                    },
                                    "writable": {
                                        "options": {
                                            "grid_columns": 12,
                                            "show_opt_in": true
                                        },
                                        "title": "For writable",
                                        "description": "Additional modifiers for writable",
                                        "propertyOrder": 60,
                                        "$ref": "#/definitions/modify"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "definitions": {
        "modify": {
            "title": "Modify",
            "type": "object",
            "_format": "grid",
            "options": {
                "show_opt_in_restore": true,
                "disable_edit_json": true,
                "disable_properties": true,
                "disable_collapse": true
            },
            "properties": {
                "mod": {
                    "options": {
                        "grid_columns": 8,
                        "show_opt_in": true
                    },
                    "description": "",
                    "propertyOrder": 20,
                    "$ref": "#/definitions/typedMod"
                },
                "ifUnset": {
                    "options": {
                        "disable_collapse": false,
                        "collapsed": true,
                        "grid_columns": 8,
                        "show_opt_in": true
                    },
                    "title": "If Unset",
                    "propertyOrder": 40,
                    "$ref": "#/definitions/typedMod"
                },
                "namedModifiers": {
                    "_format": "table",
                    "options": {
                        "grid_columns": 4,
                        "show_opt_in": true,
                        "disable_collapse": true
                    },
                    "description": "",
                    "propertyOrder": 30,
                    "$ref": "#/definitions/namedModifierNames"
                }
            }
        },
        "namedModifierNames": {
            "options": {
                "wb": {
                    "disable_panel": true
                }
            },
            "title": "Named Modifiers",
            "type": "array",
            "uniqueItems": true,
            "items": {
                "type": "string",
                "title": " ",
                "watch": {
                    "nameds": "lists.namedModifiers"
                },
                "enumSource": [
                    {
                        "source": "nameds",
                        "value": "{{item.code}}"
                    }
                ]
            }
        },
        "device": {
            "options": {
                "disable_edit_json": true,
                "disable_properties": true,
                "show_opt_in": true,
                "collapsed": true
            },
            "type": "object",
            "_format": "grid",
            "additionalProperties": false,
            "default": {
                "controls": {},
                "reverse": false
            },
            "properties": {
                "controls": {
                    "propertyOrder": 30,
                    "type": "object",
                    "additionalProperties": true,
                    "title": "Controls to modify",
                    "options": {
                        "disable_edit_json": true,
                        "disable_properties": true,
                        "grid_columns": 10
                    }
                },
                "reverse": {
                    "propertyOrder": 10,
                    "headerTemplate": "{{if rootAll == \"true\" }}Don't include all{{else}}Include all{{endif}}",
                    "type": "boolean",
                    "_format": "checkbox",
                    "watch": {
                        "rootAll": "root.all"
                    },
                    "options": {
                        "grid_columns": 1,
                        "dependencies": {
                            "root.all": true
                        }
                    }
                }
            }
        },
        "control": {
            "options": {
                "disable_properties": true,
                "disable_edit_json": true,
                "disable_collapse": false,
                "collapsed": true,
                "show_opt_in": true
            },
            "headerTemplate": "{{title}}{{, name |self.name}}{{, type |self.type}}{{, mods |self.namedModifiers}}",
            "type": "object",
            "additionalProperties": false,
            "_format": "grid",
            "properties": {
                "name": {
                    "propertyOrder": 5,
                    "title": "HA Name",
                    "description": "Name for HA",
                    "options": {
                        "grid_columns": 2,
                        "show_opt_in": true
                    },
                    "type": "string"
                },
                "namedModifiers": {
                    "_format": "table",
                    "options": {
                        "grid_columns": 5,
                        "show_opt_in": true,
                        "disable_collapse": true
                    },
                    "propertyOrder": 15,
                    "$ref": "#/definitions/namedModifierNames"
                },
                "mod": {
                    "options": {
                        "grid_columns": 12,
                        "compact": false,
                        "show_opt_in": true
                    },
                    "description": "Options for HA Discovery in control",
                    "propertyOrder": 50,
                    "$ref": "#/definitions/typedMod"
                },
                "var": {
                    "options": {
                        "grid_columns": 5,
                        "show_opt_in": true,
                        "wb": {
                            "disable_panel": true
                        },
                        "disable_collapse": true
                    },
                    "propertyOrder": 30,
                    "_format": "table",
                    "$ref": "#/definitions/var"
                }
            }
        },
        "typedMod": {
            "options": {
                "show_opt_in": true,
                "disable_properties": true,
                "grid_columns": 4,
                "disable_edit_json": true,
                "disable_collapse": true,
                "collapsed": false
            },
            "propertyOrder": 1,
            "title": "Type",
            "description": "Options for HA Discovery in control",
            "oneOf": [
                {
                    "$ref": "#/definitions/mod",
                    "title": "Any",
                    "default": [],
                    "options": {
                        "compact": false,
                        "show_opt_in": true
                    }
                },
                {
                    "type": "object",
                    "title": "alarm_control_panel",
                    "properties": {
                        "alarm_control_panel": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt alarm panel platform enables the possibility to control MQTT capable alarm panels. The Alarm icon will change state after receiving a new state from state_topic.\nhttps://www.home-assistant.io/integrations/alarm_control_panel.mqtt/",
                            "properties": {
                                "code": {
                                    "description": "If defined, specifies a code to enable or disable the alarm in the frontend.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "code_arm_required": {
                                    "description": "If true the code is required to arm the alarm. If false the code is not validated.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "code_disarm_required": {
                                    "description": "If true the code is required to disarm the alarm. If false the code is not validated.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "code_trigger_required": {
                                    "description": "If true the code is required to trigger the alarm. If false the code is not validated.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_template": {
                                    "description": "The template used for the command payload. Available variables: action and code.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the alarm state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "encoding": {
                                    "description": "The encoding of the payloads received and published messages. Set to \"\" to disable decoding of incoming payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_picture": {
                                    "description": "Picture URL for the entity.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_arm_away": {
                                    "description": "The payload to set armed-away mode on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_arm_home": {
                                    "description": "The payload to set armed-home mode on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_arm_night": {
                                    "description": "The payload to set armed-night mode on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_arm_vacation": {
                                    "description": "The payload to set armed-vacation mode on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_arm_custom_bypass": {
                                    "description": "The payload to set armed-custom-bypass mode on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_disarm": {
                                    "description": "The payload to disarm your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_trigger": {
                                    "description": "The payload to trigger the alarm on your Alarm Panel.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive sensor's state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "supported_features": {
                                    "description": "A list of features that the alarm control panel supports.",
                                    "type": "array",
                                    "items": {
                                        "enum": [
                                            "arm_away",
                                            "arm_custom_bypass",
                                            "arm_home",
                                            "arm_night",
                                            "arm_vacation",
                                            "trigger"
                                        ],
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract the value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "alarm_control_panel": {}
                    }
                },
                {
                    "type": "object",
                    "title": "binary_sensor",
                    "properties": {
                        "binary_sensor": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt binary sensor platform uses an MQTT message received to set the binary sensor’s state to on or off.\nhttps://www.home-assistant.io/integrations/binary_sensor.mqtt",
                            "properties": {
                                "device_class": {
                                    "description": "The type/class of the sensor to set the icon in the frontend.",
                                    "enum": [
                                        "battery",
                                        "battery_charging",
                                        "carbon_monoxide",
                                        "cold",
                                        "connectivity",
                                        "door",
                                        "garage_door",
                                        "gas",
                                        "heat",
                                        "light",
                                        "lock",
                                        "moisture",
                                        "motion",
                                        "moving",
                                        "occupancy",
                                        "opening",
                                        "plug",
                                        "power",
                                        "presence",
                                        "problem",
                                        "running",
                                        "safety",
                                        "smoke",
                                        "sound",
                                        "tamper",
                                        "update",
                                        "vibration",
                                        "window"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "encoding": {
                                    "description": "The encoding of the payloads received. Set to \"\" to disable decoding of incoming payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_picture": {
                                    "description": "Picture URL for the entity.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "expire_after": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "description": "Defines the number of seconds after the sensor’s state expires, if it’s not updated. After expiry, the sensor’s state becomes unavailable.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "force_update": {
                                    "description": "Sends update events even if the value hasn’t changed. Useful if you want to have meaningful value graphs in history.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "off_delay": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "description": "For sensors that only send on state updates (like PIRs), this variable sets a delay in seconds after which the sensor’s state will be updated back to off.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The string that represents the off state. It will be compared to the message in the state_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The string that represents the on state. It will be compared to the message in the state_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "platform": {
                                    "description": "Must be binary_sensor. Only allowed and required in MQTT auto discovery device messages.",
                                    "const": "binary_sensor",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive sensor's state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract the value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "binary_sensor": {}
                    }
                },
                {
                    "type": "object",
                    "title": "button",
                    "properties": {
                        "button": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt button platform lets you send an MQTT message when the button is pressed in the frontend or the button press service is called.\nhttps://www.home-assistant.io/integrations/button.mqtt",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to trigger the button.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_template": {
                                    "description": "Defines a template to generate the payload to send to command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "device_class": {
                                    "description": "Sets the class of the device, changing the device state and icon that is displayed in the frontend.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_press": {
                                    "description": "The payload to send to trigger the button.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "button": {}
                    }
                },
                {
                    "type": "object",
                    "title": "camera",
                    "properties": {
                        "camera": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt camera platform allows you to integrate the content of an image file sent through MQTT into Home Assistant as a camera.\nhttps://www.home-assistant.io/integrations/camera.mqtt/",
                            "properties": {
                                "topic": {
                                    "description": "The MQTT topic to subscribe to.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "camera": {}
                    }
                },
                {
                    "type": "object",
                    "title": "climate",
                    "properties": {
                        "climate": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt climate platform lets you control your MQTT enabled HVAC devices.\nhttps://www.home-assistant.io/integrations/climate.mqtt/",
                            "properties": {
                                "action_template": {
                                    "description": "A template to render the value received on the action_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "action_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the current action. If this is set, the climate graph uses the value received as data source. Valid values: off, heating, cooling, drying, idle, fan.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "aux_command_topic": {
                                    "description": "The MQTT topic to publish commands to switch auxiliary heat.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "aux_state_template": {
                                    "description": "A template to render the value received on the aux_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "aux_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the auxiliary heat mode. If this is not set, the auxiliary heat mode works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "current_temperature_template": {
                                    "description": "A template with which the value received on current_temperature_topic will be rendered.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "current_temperature_topic": {
                                    "description": "The MQTT topic on which to listen for the current temperature.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "encoding": {
                                    "description": "The encoding of the payloads received and published messages. Set to \"\" to disable decoding of incoming payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_mode_command_template": {
                                    "description": "A template to render the value sent to the fan_mode_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the fan mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_mode_state_template": {
                                    "description": "A template to render the value received on the fan_mode_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_mode_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the HVAC fan mode. If this is not set, the fan mode works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_modes": {
                                    "description": "A list of supported fan modes.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "initial": {
                                    "type": "integer",
                                    "description": "Set the initial target temperature.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max_temp": {
                                    "description": "Maximum set point available.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min_temp": {
                                    "description": "Minimum set point available.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_command_template": {
                                    "description": "A template to render the value sent to the mode_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the HVAC operation mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_state_template": {
                                    "description": "A template to render the value received on the mode_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the HVAC operation mode. If this is not set, the operation mode works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "modes": {
                                    "description": "A list of supported modes. Needs to be a subset of the default values.",
                                    "type": "array",
                                    "items": {
                                        "enum": [
                                            "auto",
                                            "cool",
                                            "dry",
                                            "fan_only",
                                            "heat",
                                            "off"
                                        ],
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents disabled state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents enabled state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "power_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the power state. This is useful if your device has a separate power toggle in addition to mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "precision": {
                                    "description": "The desired precision for this device. Can be used to match your actual thermostat’s precision. Supported values are 0.1, 0.5 and 1.0.",
                                    "enum": [
                                        0.1,
                                        0.5,
                                        1
                                    ],
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_command_template": {
                                    "description": "Defines a template to generate the payload to send to preset_mode_command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the preset mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_state_topic": {
                                    "description": "The MQTT topic subscribed to receive climate speed based on presets. When preset ‘none’ is received or None the preset_mode will be reset.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_value_template": {
                                    "description": "Defines a template to extract the preset_mode value from the payload received on preset_mode_state_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_modes": {
                                    "description": "List of preset modes this climate is supporting. Common examples include eco, away, boost, comfort, home, sleep and activity.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "swing_mode_command_template": {
                                    "description": "A template to render the value sent to the swing_mode_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "swing_mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the swing mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "swing_mode_state_template": {
                                    "description": "A template to render the value received on the swing_mode_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "swing_mode_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the HVAC swing mode. If this is not set, the swing mode works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "swing_modes": {
                                    "description": "A list of supported swing modes.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "temperature_command_template": {
                                    "description": "A template to render the value sent to the temperature_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the target temperature.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_high_command_template": {
                                    "description": "A template to render the value sent to the temperature_high_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_high_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the high target temperature.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_high_state_template": {
                                    "description": "A template to render the value received on the temperature_high_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_high_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes in the target high temperature. If this is not set, the target high temperature works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_low_command_template": {
                                    "description": "A template to render the value sent to the temperature_high_command_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_low_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the target low temperature.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_low_state_template": {
                                    "description": "A template to render the value received on the temperature_low_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_low_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes in the target low temperature. If this is not set, the target low temperature works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_state_template": {
                                    "description": "A template to render the value received on the temperature_state_topic with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_state_topic": {
                                    "description": "The MQTT topic to subscribe for changes in the target temperature. If this is not set, the target temperature works in optimistic mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temperature_unit": {
                                    "description": "Defines the temperature unit of the device, C or F. If this is not set, the temperature unit is set to the system temperature unit.",
                                    "enum": [
                                        "C",
                                        "F"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "temp_step": {
                                    "description": "Step size for temperature set point.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Default template to render the payloads on all *_state_topics with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "climate": {}
                    }
                },
                {
                    "type": "object",
                    "title": "cover",
                    "properties": {
                        "cover": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt cover platform allows you to control an MQTT cover (such as blinds, a rollershutter or a garage door).\nhttps://www.home-assistant.io/integrations/cover.mqtt/",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to control the cover.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "device_class": {
                                    "description": "Sets the class of the device, changing the device state and icon that is displayed on the frontend.",
                                    "enum": [
                                        "awning",
                                        "blind",
                                        "curtain",
                                        "damper",
                                        "door",
                                        "garage",
                                        "gate",
                                        "shade",
                                        "shutter",
                                        "window"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if switch works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_close": {
                                    "description": "The command payload that closes the cover.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_open": {
                                    "description": "The command payload that opens the cover.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_stop": {
                                    "description": "The command payload that stops the cover.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "position_closed": {
                                    "type": "integer",
                                    "description": "Number which represents closed position.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "position_open": {
                                    "type": "integer",
                                    "description": "Number which represents open position.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "position_template": {
                                    "description": "Defines a template that can be used to extract the payload for the `position_topic` topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "position_topic": {
                                    "description": "The MQTT topic subscribed to receive cover position messages. If position_topic is set state_topic is ignored.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "set_position_template": {
                                    "description": "Defines a template to define the position to be sent to the set_position_topic topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "set_position_topic": {
                                    "description": "The MQTT topic to publish position commands to. You need to set position_topic as well if you want to use position topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_closed": {
                                    "description": "The payload that represents the closed state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_closing": {
                                    "description": "The payload that represents the closing state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_open": {
                                    "description": "The payload that represents the open state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_opening": {
                                    "description": "The payload that represents the opening state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_stopped": {
                                    "description": "The payload that represents the stopped state (for covers that do not report open/closed state).",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive cover state messages. Use only if not using position_topic. State topic can only read open/close state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_closed_value": {
                                    "type": "integer",
                                    "description": "The value that will be sent on a close_cover_tilt command.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_command_template": {
                                    "description": "Defines a template that can be used to extract the payload for the `tilt_command_topic` topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_command_topic": {
                                    "description": "The MQTT topic to publish commands to control the cover tilt.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_max": {
                                    "type": "integer",
                                    "description": "The maximum tilt value.\n https://www.home-assistant.io/integrations/cover.mqtt/#tilt_max",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_min": {
                                    "type": "integer",
                                    "description": "The minimum tilt value.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_opened_value": {
                                    "type": "integer",
                                    "description": "The value that will be sent on an open_cover_tilt command.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_optimistic": {
                                    "description": "Flag that determines if tilt works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_status_template": {
                                    "description": "Defines a template that can be used to extract the payload for the tilt_status_topic topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "tilt_status_topic": {
                                    "description": "The MQTT topic subscribed to receive tilt status update values.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract a value from the payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "cover": {}
                    }
                },
                {
                    "type": "object",
                    "title": "device_tracker",
                    "properties": {
                        "device_tracker": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt device tracker platform allows you to detect presence by monitoring an MQTT topic for new locations.\nhttps://www.home-assistant.io/integrations/device_tracker.mqtt/",
                            "properties": {
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive device tracker state changes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template that returns a device tracker state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_home": {
                                    "description": "The payload value that represents the ‘home’ state for the device.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_home": {
                                    "description": "The payload value that represents the ‘not_home’ state for the device.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_reset": {
                                    "description": "The payload value that will have the device’s location automatically derived from Home Assistant’s zones.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "source_type": {
                                    "description": "Attribute of a device tracker that affects state when being used to track a person. Valid options are gps, router, bluetooth, or bluetooth_le.",
                                    "enum": [
                                        "bluetooth",
                                        "bluetooth_le",
                                        "gps",
                                        "router"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "platform": {
                                    "description": "Must be `device_tracker`. Only allowed and required in MQTT auto discovery device messages.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "devices": {
                                    "description": "List of devices with their topic (legacy YAML configuration).",
                                    "type": "object",
                                    "additionalProperties": {
                                        "type": "string"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    },
                                    "_format": "grid"
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "device_tracker": {}
                    }
                },
                {
                    "type": "object",
                    "title": "fan",
                    "properties": {
                        "fan": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt fan platform lets you control your MQTT enabled fans.\nhttps://www.home-assistant.io/integrations/fan.mqtt/",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the fan state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_template": {
                                    "description": "The template used for the command payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if fan works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "direction_command_template": {
                                    "description": "Defines a template to generate the payload to send to `direction_command_template`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "direction_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the fan direction state based on a value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "direction_state_topic": {
                                    "description": "The MQTT topic subscribed to receive fan direction.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "direction_value_template": {
                                    "description": "Defines a template to extract a value from fan direction.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "oscillation_command_template": {
                                    "description": "Defines a template to generate the payload to send to oscillation_command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "oscillation_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the oscillation state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "oscillation_state_topic": {
                                    "description": "The MQTT topic subscribed to receive oscillation state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "oscillation_value_template": {
                                    "description": "Defines a template to extract a value from the oscillation.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents the stop state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents the running state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_oscillation_off": {
                                    "description": "The payload that represents the oscillation off state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_oscillation_on": {
                                    "description": "The payload that represents the oscillation on state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_reset_percentage": {
                                    "description": "A special payload that resets the `percentage` state attribute to `None` when received at the `percentage_state_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_reset_preset_mode": {
                                    "description": "A special payload that resets the `preset_mode` state attribute to `None` when received at the `preset_mode_state_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "percentage_command_template": {
                                    "description": "Defines a template to generate the payload to send to `percentage_command_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "percentage_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the fan speed state based on a percentage.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "percentage_state_topic": {
                                    "description": "The MQTT topic subscribed to receive fan speed based on percentage.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "percentage_value_template": {
                                    "description": "Defines a template to extract a value from fan percentage speed.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_command_template": {
                                    "description": "Defines a template to generate the payload to send to preset_mode_command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the preset mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_state_topic": {
                                    "description": "The MQTT topic subscribed to receive fan speed based on presets.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_mode_value_template": {
                                    "description": "Defines a template to extract a value from the preset_mode payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "preset_modes": {
                                    "description": "List of preset modes this fan is capable of running at.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "speed_range_min": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "description": "The minimum of numeric output range (off not included, so speed_range_min - 1 represents 0%).",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "speed_range_max": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "description": "The maximum of numeric output range (representing 100%).",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_value_template": {
                                    "description": "Defines a template to extract a value from the state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "fan": {}
                    }
                },
                {
                    "type": "object",
                    "title": "humidifier",
                    "properties": {
                        "humidifier": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt humidifier platform lets you control your MQTT enabled humidifiers.\nhttps://www.home-assistant.io/integrations/humidifier.mqtt",
                            "properties": {
                                "action_topic": {
                                    "description": "The MQTT topic to subscribe for changes of the current action.\nValid values: `off`, `humidifying`, `drying`, `idle`",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "action_template": {
                                    "description": "A template to render the value received on the `action_topic` with.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_template": {
                                    "description": "Defines a template to generate the payload to send to `command_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the humidifier state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "current_humidity_template": {
                                    "description": "A template with which the value received on `current_humidity_topic` will be rendered.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "current_humidity_topic": {
                                    "description": "The MQTT topic on which to listen for the current humidity.\nA `\"None\"` value received will reset the current humidity. Empty values (`'''`) will be ignored.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "device_class": {
                                    "description": "The device class of the MQTT device.\nMust be either `humidifier`, `dehumidifier` or `null`.",
                                    "anyOf": [
                                        {
                                            "enum": [
                                                "dehumidifier",
                                                "humidifier"
                                            ],
                                            "type": "string"
                                        },
                                        {
                                            "type": "null"
                                        }
                                    ],
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "encoding": {
                                    "description": "The encoding of the payloads received and published messages.\nSet to `\"\"` to disable decoding of incoming payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_picture": {
                                    "description": "Picture URL for the entity.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max_humidity": {
                                    "description": "The maximum target humidity percentage that can be set.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min_humidity": {
                                    "description": "The minimum target humidity percentage that can be set.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_command_template": {
                                    "description": "Defines a template to generate the payload to send to `mode_command_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the `mode` on the humidifier.\nThis attribute must be configured together with the `modes` attribute.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_state_topic": {
                                    "description": "The MQTT topic subscribed to receive the humidifier `mode`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "mode_state_template": {
                                    "description": "Defines a template to extract a value for the humidifier `mode` state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "modes": {
                                    "description": "List of available modes this humidifier is capable of running at.\nCommon examples include `normal`, `eco`, `away`, `boost`, `comfort`, `home`, `sleep`, `auto` and `baby`.\nThis attribute must be configured together with the `mode_command_topic` attribute.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if humidifier works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents the stop state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents the running state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_reset_humidity": {
                                    "description": "A special payload that resets the `target_humidity` state attribute to an `unknown` state when received at the `target_humidity_state_topic`.\nWhen received at `current_humidity_topic` it will reset the current humidity state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_reset_mode": {
                                    "description": "A special payload that resets the `mode` state attribute to an `unknown` state when received at the `mode_state_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_value_template": {
                                    "description": "Defines a template to extract a value from the state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "target_humidity_command_template": {
                                    "description": "Defines a template to generate the payload to send to `target_humidity_command_topic`.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "target_humidity_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the humidifier target humidity state based on a percentage.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "target_humidity_state_topic": {
                                    "description": "The MQTT topic subscribed to receive humidifier target humidity.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "target_humidity_state_template": {
                                    "description": "Defines a template to extract a value for the humidifier `target_humidity` state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "humidifier": {}
                    }
                },
                {
                    "type": "object",
                    "title": "image",
                    "properties": {
                        "image": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt image platform allows you to integrate the content of an image file sent through MQTT into Home Assistant as an image.\nhttps://www.home-assistant.io/integrations/image.mqtt",
                            "properties": {
                                "content_type": {
                                    "description": "The content type of an image data message received on image_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "image_encoding": {
                                    "description": "The encoding of the image payloads received.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "image_topic": {
                                    "description": "The MQTT topic to subscribe to receive the image payload of the image to be downloaded.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "url_template": {
                                    "description": "Defines a template to extract the image URL from a message received at url_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "url_topic": {
                                    "description": "The MQTT topic to subscribe to receive an image URL.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "image": {}
                    }
                },
                {
                    "type": "object",
                    "title": "light basic",
                    "properties": {
                        "light": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt light platform lets you control your MQTT enabled lights through one of the supported message schemas, default, json or template.\nhttps://www.home-assistant.io/integrations/light.mqtt/",
                            "properties": {
                                "schema": {
                                    "description": "The mqtt light platform with default schema lets you control your MQTT enabled lights. It supports setting brightness, color temperature, effects, flashing, on/off, RGB colors, transitions, XY colors and white values.",
                                    "type": "string",
                                    "options": {
                                        "hidden": true
                                    },
                                    "enum": [
                                        "basic"
                                    ]
                                },
                                "brightness_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s brightness.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "brightness_scale": {
                                    "type": "integer",
                                    "description": "Defines the maximum brightness value (i.e., 100%) of the MQTT device.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "brightness_state_topic": {
                                    "description": "The MQTT topic subscribed to receive brightness state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "brightness_value_template": {
                                    "description": "Defines a template to extract the brightness value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_mode_state_topic": {
                                    "description": "The MQTT topic subscribed to receive color mode updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_mode_value_template": {
                                    "description": "Defines a template to extract the color mode.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp_command_template": {
                                    "description": "Defines a template to compose message which will be sent to color_temp_command_topic. Available variables: value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s color temperature state. The color temperature command slider has a range of 153 to 500 mireds (micro reciprocal degrees).",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp_state_topic": {
                                    "description": "The MQTT topic subscribed to receive color temperature state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp_value_template": {
                                    "description": "Defines a template to extract the color temperature value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the switch state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s effect state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_list": {
                                    "description": "The list of effects the light supports.",
                                    "anyOf": [
                                        {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        },
                                        {
                                            "type": "string"
                                        }
                                    ],
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_state_topic": {
                                    "description": "The MQTT topic subscribed to receive effect state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_value_template": {
                                    "description": "Defines a template to extract the effect value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "hs_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s color state in HS format (Hue Saturation). Range for Hue: 0° .. 360°, Range of Saturation: 0..100.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "hs_state_topic": {
                                    "description": "The MQTT topic subscribed to receive color state updates in HS format.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "hs_value_template": {
                                    "description": "Defines a template to extract the HS value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max_mireds": {
                                    "type": "integer",
                                    "description": "The maximum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min_mireds": {
                                    "type": "integer",
                                    "description": "The minimum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "on_command_type": {
                                    "description": "Defines when on the payload_on is sent. Using last (the default) will send any style (brightness, color, etc) topics first and then a payload_on to the command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if light works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents disabled state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents enabled state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "rgb_command_template": {
                                    "description": "Defines a template to compose message which will be sent to rgb_command_topic. Available variables: red, green and blue.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "rgb_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s RGB state. Please note that the color value sent by Home Assistant is normalized to full brightness if brightness_command_topic is set.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "rgb_state_topic": {
                                    "description": "The MQTT topic subscribed to receive RGB state updates. The expected payload is the RGB values separated by commas, for example, 255,0,127.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "rgb_value_template": {
                                    "description": "Defines a template to extract the RGB value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_value_template": {
                                    "description": "Defines a template to extract a value from the state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "white_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light to white mode with a given brightness.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "white_scale": {
                                    "type": "integer",
                                    "description": "Defines the maximum white level (i.e., 100%) of the MQTT device.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "xy_command_topic": {
                                    "description": "The MQTT topic to publish commands to change the light’s XY state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "xy_state_topic": {
                                    "description": "The MQTT topic subscribed to receive XY state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "xy_value_template": {
                                    "description": "Defines a template to extract the XY value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid",
                            "default": {
                                "schema": "basic"
                            }
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "light": {
                            "schema": "basic"
                        }
                    }
                },
                {
                    "type": "object",
                    "title": "light json",
                    "properties": {
                        "light": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt light platform lets you control your MQTT enabled lights through one of the supported message schemas, default, json or template.\nhttps://www.home-assistant.io/integrations/light.mqtt/",
                            "properties": {
                                "schema": {
                                    "description": "The mqtt light platform with default schema lets you control your MQTT enabled lights. It supports setting brightness, color temperature, effects, flashing, on/off, RGB colors, transitions, XY colors and white values.",
                                    "type": "string",
                                    "options": {
                                        "hidden": true
                                    },
                                    "enum": [
                                        "json"
                                    ]
                                },
                                "brightness": {
                                    "description": "Flag that defines if the light supports brightness.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "brightness_scale": {
                                    "type": "integer",
                                    "description": "Defines the maximum brightness value (i.e., 100%) of the MQTT device.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_mode": {
                                    "description": "Flag that defines if the light supports color modes.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp": {
                                    "description": "Flag that defines if the light supports color temperature.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the switch state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect": {
                                    "description": "Flag that defines if the light supports effects.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_list": {
                                    "description": "The list of effects the light supports.",
                                    "anyOf": [
                                        {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        },
                                        {
                                            "type": "string"
                                        }
                                    ],
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "flash_time_long": {
                                    "type": "integer",
                                    "description": "The duration, in seconds, of a “long” flash.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "flash_time_short": {
                                    "type": "integer",
                                    "description": "The duration, in seconds, of a “short” flash.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "hs": {
                                    "description": "Flag that defines if the light supports HS colors.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max_mireds": {
                                    "type": "integer",
                                    "description": "The maximum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min_mireds": {
                                    "type": "integer",
                                    "description": "The minimum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if light works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "rgb": {
                                    "description": "Flag that defines if the light supports RGB colors.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "supported_color_modes": {
                                    "description": "A list of color modes supported by the light.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/ColorMode",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "white_value": {
                                    "description": "Flag that defines if the light supports white values.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "xy": {
                                    "description": "Flag that defines if the light supports XY colors.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid",
                            "default": {
                                "schema": "json"
                            }
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "light": {
                            "schema": "json"
                        }
                    }
                },
                {
                    "type": "object",
                    "title": "light template",
                    "properties": {
                        "light": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt light platform lets you control your MQTT enabled lights through one of the supported message schemas, default, json or template.\nhttps://www.home-assistant.io/integrations/light.mqtt/",
                            "properties": {
                                "schema": {
                                    "description": "The mqtt light platform with default schema lets you control your MQTT enabled lights. It supports setting brightness, color temperature, effects, flashing, on/off, RGB colors, transitions, XY colors and white values.",
                                    "type": "string",
                                    "options": {
                                        "hidden": true
                                    },
                                    "enum": [
                                        "template"
                                    ]
                                },
                                "blue_template": {
                                    "description": "Template to extract blue color from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "brightness_template": {
                                    "description": "Template to extract brightness from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "color_temp_template": {
                                    "description": "Template to extract color temperature from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_off_template": {
                                    "description": "The template for off state changes. Available variables: state and transition.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_on_template": {
                                    "description": "The template for on state changes. Available variables: state, brightness, red, green, blue, white_value, flash, transition and effect.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the switch state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_list": {
                                    "description": "The list of effects the light supports.",
                                    "anyOf": [
                                        {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        },
                                        {
                                            "type": "string"
                                        }
                                    ],
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "effect_template": {
                                    "description": "Template to extract effect from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "green_template": {
                                    "description": "Template to extract green color from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max_mireds": {
                                    "type": "integer",
                                    "description": "The maximum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min_mireds": {
                                    "type": "integer",
                                    "description": "The minimum color temperature in mireds.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if light works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "red_template": {
                                    "description": "Template to extract red color from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_template": {
                                    "description": "Template to extract red color from the state payload value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid",
                            "default": {
                                "schema": "template"
                            }
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "light": {
                            "schema": "template"
                        }
                    }
                },
                {
                    "type": "object",
                    "title": "lock",
                    "properties": {
                        "lock": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt lock platform lets you control your MQTT enabled locks.\nhttps://www.home-assistant.io/integrations/lock.mqtt/",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the lock state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if lock works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_lock": {
                                    "description": "The payload that represents enabled/locked state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_unlock": {
                                    "description": "The value that represents the lock to be in unlocked state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_locked": {
                                    "description": "The value that represents the lock to be in locked state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_unlocked": {
                                    "description": "The value that represents the lock to be in unlocked state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract a value from the payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "lock": {}
                    }
                },
                {
                    "type": "object",
                    "title": "number",
                    "properties": {
                        "number": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The MQTT number platform.\nhttps://www.home-assistant.io/integrations/number.mqtt/",
                            "properties": {
                                "mode": {
                                    "description": "Control how the number should be displayed in the UI. Can be set to box or slider to force a display mode.",
                                    "enum": [
                                        "box",
                                        "slider"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the number state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "max": {
                                    "description": "Maximum value.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "min": {
                                    "description": "Minimum value.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if the number works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "step": {
                                    "description": "Step value. Smallest value `0.001`.",
                                    "type": "number",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "unit_of_measurement": {
                                    "description": "Defines the units of measurement, if any.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract the value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "number": {}
                    }
                },
                {
                    "type": "object",
                    "title": "scene",
                    "properties": {
                        "scene": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt scene platform lets you control your MQTT enabled scenes.\nhttps://www.home-assistant.io/integrations/scene.mqtt/",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the scene state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if the scene works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload": {
                                    "description": "The payload that represents the scene.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract a value from the state payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "scene": {}
                    }
                },
                {
                    "type": "object",
                    "title": "select",
                    "properties": {
                        "select": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "This mqtt select platform uses the MQTT message payload as the select value.\nhttps://www.home-assistant.io/integrations/select.mqtt",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to control the select.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines the select works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "options": {
                                    "description": "List of options to choose from in the select.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive the select value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract a value from the payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "select": {}
                    }
                },
                {
                    "type": "object",
                    "title": "siren",
                    "properties": {
                        "siren": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt siren platform lets you control your MQTT enabled sirens and text based notification devices.\nhttps://www.home-assistant.io/integrations/siren.mqtt",
                            "properties": {
                                "available_tones": {
                                    "description": "The list of available tones the siren supports.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "command_template": {
                                    "description": "Defines a template to generate a custom payload to send to command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_off_template": {
                                    "description": "Defines a template to generate a custom payload to send to command_topic when the siren turn off action is called.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the siren state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "support_duration": {
                                    "description": "Defines if the siren supports the duration option.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "support_volume_set": {
                                    "description": "Defines if the siren supports setting the volume.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_value_template": {
                                    "description": "Defines a template to extract device's state from the state_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents off state. If specified, will be used for both comparing to the value in the state_topic and sending as off command to the command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents on state. If specified, will be used for both comparing to the value in the state_topic and sending as on command to the command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_off": {
                                    "description": "The payload that represents the off state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_on": {
                                    "description": "The payload that represents the on state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if siren works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "siren": {}
                    }
                },
                {
                    "type": "object",
                    "title": "sensor",
                    "properties": {
                        "sensor": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "This mqtt sensor platform uses the MQTT message payload as the sensor value.\nhttps://www.home-assistant.io/integrations/sensor.mqtt",
                            "properties": {
                                "device_class": {
                                    "description": "The type/class of the sensor to set the icon in the frontend.",
                                    "enum": [
                                        "apparent_power",
                                        "aqi",
                                        "area",
                                        "atmospheric_pressure",
                                        "battery",
                                        "blood_glucose_concentration",
                                        "carbon_dioxide",
                                        "carbon_monoxide",
                                        "conductivity",
                                        "current",
                                        "data_rate",
                                        "data_size",
                                        "date",
                                        "distance",
                                        "duration",
                                        "energy",
                                        "energy_distance",
                                        "energy_storage",
                                        "enum",
                                        "frequency",
                                        "gas",
                                        "humidity",
                                        "illuminance",
                                        "irradiance",
                                        "moisture",
                                        "monetary",
                                        "nitrogen_dioxide",
                                        "nitrogen_monoxide",
                                        "nitrous_oxide",
                                        "ozone",
                                        "ph",
                                        "pm1",
                                        "pm10",
                                        "pm25",
                                        "power",
                                        "power_factor",
                                        "precipitation",
                                        "precipitation_intensity",
                                        "pressure",
                                        "reactive_power",
                                        "signal_strength",
                                        "sound_pressure",
                                        "speed",
                                        "sulphur_dioxide",
                                        "temperature",
                                        "timestamp",
                                        "volatile_organic_compounds",
                                        "volatile_organic_compounds_parts",
                                        "voltage",
                                        "volume",
                                        "volume_flow_rate",
                                        "volume_storage",
                                        "water",
                                        "weight",
                                        "wind_speed"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "encoding": {
                                    "description": "The encoding of the payloads received. Set to \"\" to disable decoding of incoming payload.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_picture": {
                                    "description": "Picture URL for the entity.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "expire_after": {
                                    "type": "integer",
                                    "minimum": 0,
                                    "description": "Defines the number of seconds after the sensor’s state expires, if it’s not updated. After expiry, the sensor’s state becomes unavailable.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "force_update": {
                                    "description": "Sends update events even if the value hasn’t changed. Useful if you want to have meaningful value graphs in history.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "last_reset_topic": {
                                    "description": "The MQTT topic subscribed to receive timestamps for when an accumulating sensor such as an energy meter was reset. If the sensor never resets, set last_reset_topic to same as state_topic and set the last_reset_value_template to a constant valid timstamp, for example UNIX epoch 0: 1970-01-01T00:00:00+00:00.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "last_reset_value_template": {
                                    "description": "Defines a template to extract the last_reset. Available variables: entity_id. The entity_id can be used to reference the entity’s attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "options": {
                                    "description": "List of allowed sensor state value. An empty list is not allowed. The sensor's device_class must be set to enum.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "platform": {
                                    "description": "Must be sensor. Only allowed and required in MQTT auto discovery device messages.",
                                    "const": "sensor",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_class": {
                                    "description": "The state_class of the sensor.",
                                    "enum": [
                                        "measurement",
                                        "total",
                                        "total_increasing"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive sensor values.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "suggested_display_precision": {
                                    "type": "integer",
                                    "description": "The number of decimals which should be used in the sensor's state after rounding.",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "unit_of_measurement": {
                                    "description": "Defines the units of measurement of the sensor, if any.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract the value.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "sensor": {}
                    }
                },
                {
                    "type": "object",
                    "title": "switch",
                    "properties": {
                        "switch": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt switch platform lets you control your MQTT enabled switches.\nhttps://www.home-assistant.io/integrations/switch.mqtt",
                            "properties": {
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to change the switch state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "command_template": {
                                    "description": "Defines a template to generate the payload to send to command_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "device_class": {
                                    "description": "Sets the class of the device, changing the device state and icon that is displayed on the frontend.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "optimistic": {
                                    "description": "Flag that defines if switch works in optimistic mode.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_off": {
                                    "description": "The payload that represents the off state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_on": {
                                    "description": "The payload that represents the on state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_off": {
                                    "description": "The payload that represents the off state. Used when value that represents off state in the state_topic is different from value that should be sent to the command_topic to turn the device off.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_on": {
                                    "description": "The payload that represents the on state. Used when value that represents on state in the state_topic is different from value that should be sent to the command_topic to turn the device on.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "value_template": {
                                    "description": "Defines a template to extract device's state from the state_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid"
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "switch": {}
                    }
                },
                {
                    "type": "object",
                    "title": "vacuum state",
                    "properties": {
                        "vacuum": {
                            "title": " ",
                            "options": {
                                "disable_properties": true,
                                "disable_edit_json": true,
                                "disable_collapse": false,
                                "collapsed": true
                            },
                            "type": "object",
                            "description": "The mqtt vacuum integration allows you to control your MQTT-enabled vacuum.\nhttps://www.home-assistant.io/integrations/vacuum.mqtt",
                            "properties": {
                                "schema": {
                                    "description": "The schema to use. Must be state to select the state schema.",
                                    "type": "string",
                                    "options": {
                                        "hidden": true
                                    },
                                    "enum": [
                                        "state"
                                    ]
                                },
                                "command_topic": {
                                    "description": "The MQTT topic to publish commands to control the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_speed_list": {
                                    "description": "List of possible fan speeds for the vacuum.",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "fan_speed_template": {
                                    "description": "Defines a template to define the fan speed of the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "fan_speed_topic": {
                                    "description": "The MQTT topic subscribed to receive fan speed values from the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_clean_spot": {
                                    "description": "The payload to send to the command_topic to begin a spot cleaning cycle.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_locate": {
                                    "description": "The payload to send to the command_topic to locate the vacuum (typically plays a song).",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_pause": {
                                    "description": "The payload to send to the command_topic to pause the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_return_to_base": {
                                    "description": "The payload to send to the command_topic to tell the vacuum to return to base.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_start": {
                                    "description": "The payload to send to the command_topic to begin the cleaning cycle.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_stop": {
                                    "description": "The payload to send to the command_topic to stop the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "send_command_topic": {
                                    "description": "The MQTT topic to publish custom commands to the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "set_fan_speed_topic": {
                                    "description": "The MQTT topic to publish commands to control the vacuum’s fan speed.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "state_topic": {
                                    "description": "The MQTT topic subscribed to receive state messages from the vacuum.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "supported_features": {
                                    "description": "List of features that the vacuum supports (possible values are start, stop, pause, return_home, battery, status, locate, clean_spot, fan_speed, send_command).",
                                    "type": "array",
                                    "items": {
                                        "type": "string",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability": {
                                    "description": "A list of MQTT topics subscribed to receive availability (online/offline) updates.",
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/definitions/Availability",
                                        "_format": "wb-object"
                                    },
                                    "options": {
                                        "show_opt_in": true,
                                        "disable_properties": true,
                                        "disable_edit_json": true,
                                        "collapsed": true
                                    }
                                },
                                "availability_mode": {
                                    "description": "When availability is configured, this controls the conditions needed to set the entity to available. Valid entries are all, any, and latest.",
                                    "enum": [
                                        "all",
                                        "any",
                                        "latest"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_template": {
                                    "description": "Defines a template to extract device’s availability from the availability_topic. To determine the devices’s availability result of this template will be compared to payload_available and payload_not_available.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "availability_topic": {
                                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_available": {
                                    "description": "The payload that represents the available state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "payload_not_available": {
                                    "description": "The payload that represents the unavailable state.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "enabled_by_default": {
                                    "description": "Flag which defines if the entity should be enabled when first added.",
                                    "type": "boolean",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "entity_category": {
                                    "description": "The category of the entity. When set, the entity category must be \"diagnostic\" for sensors.",
                                    "enum": [
                                        "config",
                                        "diagnostic"
                                    ],
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "icon": {
                                    "description": "Icon to use for the entity created.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_template": {
                                    "description": "Defines a template to extract the JSON dictionary from messages received on the json_attributes_topic.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                },
                                "json_attributes_topic": {
                                    "description": "The MQTT topic subscribed to receive a JSON dictionary payload and then set as sensor attributes.",
                                    "type": "string",
                                    "options": {
                                        "show_opt_in": true
                                    }
                                }
                            },
                            "_format": "grid",
                            "default": {
                                "schema": "state"
                            }
                        }
                    },
                    "additionalProperties": false,
                    "default": {
                        "vacuum": {
                            "schema": "state"
                        }
                    }
                }
            ]
        },
        "mod": {
            "title": "HA Discovery Payload",
            "type": "array",
            "options": {
                "wb": {
                    "disable_panel": true
                },
                "disable_collapse": true
            },
            "items": {
                "type": "object",
                "additionalProperties": false,
                "_format": "wb-object",
                "options": {
                    "disable_edit_json": true,
                    "disable_properties": true,
                    "wb": {
                        "disable_panel": true
                    },
                    "collapsed": true
                },
                "title": "Option",
                "headerTemplate": "{{ self.code }} = {{ self.value }}",
                "properties": {
                    "code": {
                        "title": "Option",
                        "type": "string",
                        "pattern": "^[a-zA-Z0-9_-]+$"
                    },
                    "value": {
                        "title": "Value",
                        "options": {
                            "titleHidden": true
                        }
                    }
                }
            }
        },
        "var": {
            "title": "Variables",
            "description": "Values for the variables in the form of {var}",
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "code": {
                        "title": "Placeholder",
                        "type": "string",
                        "pattern": "^[a-zA-Z0-9_]+$"
                    },
                    "value": {
                        "title": "Value"
                    }
                }
            }
        },
        "Availability": {
            "type": "object",
            "properties": {
                "topic": {
                    "description": "The MQTT topic subscribed to receive availability (online/offline) updates.",
                    "type": "string",
                    "options": {
                        "show_opt_in": true
                    }
                },
                "payload_available": {
                    "description": "The payload that represents the available state.",
                    "type": "string",
                    "options": {
                        "show_opt_in": true
                    }
                },
                "payload_not_available": {
                    "description": "The payload that represents the unavailable state.",
                    "type": "string",
                    "options": {
                        "show_opt_in": true
                    }
                },
                "value_template": {
                    "description": "Defines a template to extract the value for payload_available and payload_not_available.",
                    "type": "string",
                    "options": {
                        "show_opt_in": true
                    }
                }
            },
            "additionalProperties": false,
            "required": [
                "topic"
            ]
        },
        "ColorMode": {
            "description": "From: https://github.com/home-assistant/core/blob/dev/homeassistant/components/light/const.py",
            "enum": [
                "brightness",
                "color_temp",
                "hs",
                "onoff",
                "rgb",
                "rgbw",
                "rgbww",
                "unknown",
                "white",
                "xy"
            ],
            "type": "string"
        }
    },
    "translations": {
        "ru": {
            "WB unit modifiers": "Опции MQTT Discovery, которые следует добавить для контрола с такой единицей измерения",
            "WB unit name": "Сокращенное обозначение единицы измерения в WirenBoard",
            "Abbreviation": "Сокращение",
            "Measurement Units": "Единицы измерения",
            "Measurement Unit": "Единица измерения",
            "WB Units mods": "Модификаторы, автоматически применяемые контролам (элементам управления и показателям) устройств WirenBoard в зависимости от указанной в них единице измерения",
            "Option": "Опция",
            "Value": "Значение",
            "For readonly": "Если только чтение",
            "Additional modifiers for readonly": "Дополнительные модификаторы для контролов, доступных только для чтения",
            "For writable": "Если изменяемый",
            "Additional modifiers for writable": "Дополнительные модификаторы для изменяемых контролов",
            "Other Named Modifiers": "Другие именованные модификаторы",
            "Variables": "Переменные",
            "Values for the variables in the form of {var}": "Значения переменных вида {var}",
            "Controls to modify": "Какие контролы изменить при публикации",
            "{{if rootAll == \"true\" }}Don't include all{{else}}Include all{{endif}}": "{{if rootAll == \"true\" }}Все не добавлять{{else}}Добавить все{{endif}}",
            "WB control modifiers": "Опции MQTT Discovery, которые следует добавить для этого контрола",
            "Modify": "Изменить",
            "WB control type name": "Наименование типа элемента управления или индикатора (\"контрола\") в WirenBoard",
            "Control Types": "Типы контролов",
            "Control Type": "Тип контрола",
            "WB Control Types mods": "Модификаторы, автоматически применяемые контролам (элементам управления и показателям) устройств WirenBoard в зависимости от их типа",
            "{{title}}{{, name |self.name}}{{, type |self.type}}{{, mods |self.namedModifiers}}": "{{title}}{{, имя |self.name}}{{, тип |self.type}}{{, мод |self.namedModifiers}}",
            "{{title}}{{, name |self.name}}{{, type |self.type}}": "{{title}}{{, имя |self.name}}{{, тип |self.type}}",
            "HA Name": "Имя",
            "Name for HA": "Опубликовать контрол в Home Assistant с таким наименованием сущности",
            "Options for HA Discovery in control": "Опции для добавления в сообщение Home Assistant MQTT Discovery. Можно использовать переменные в виде {device.id}, {control.id}, {control.meta.units}, а также произвольные переменные вида {var}, которые надо будет задать для этого контрола в разделе \"Переменные\"",
            "Options for HA Discovery in Named Mod": "Дополнительные опции для добавления в сообщение Home Assistant MQTT Discovery. Можно использовать переменные в виде {device.id}, {control.id}, {control.meta.units}, а также произвольные переменные вида {var}, которые надо будет задать для каждого контрола, использующего этот модификатор",
            "HA Discovery Payload": "Содержимое сообщения MQTT Discovery",
            "Replace HA Type to this": "При активации этого пункта будет указан этот тип устройства Home Assistant (\"платформа\")",
            "Platform": "Тип",
            "These are named sets of options": "Поименованные наборы опций, которые можно добавлять в сообщения топиков обнаружения Home Assistant MQTT Discovery",
            "Name of the modifier": "Имя модификатора для указания там, где нужно добавить эти опции обнаружения MQTT Discovery",
            "Name": "Имя",
            "Definition": "Определение",
            "Named Modifiers": "Именованные модификаторы",
            "Named Modifier": "Именованный модификатор",
            "wb2ha Configuration": "wb2ha - Настройка отображения устройств WirenBoard в Home Assistant",
            "Configure WB devices to add to HA": "Выбирайте контролы WirenBoard на вкладке \"Устройства WirenBoard\" для публикации в Home Assistant с помощью функции MQTT Discovery, в том числе изменяя отправляемые опции. Используйте другие вкладки для настройки часто используемых групп изменений",
            "HA root": "Корень топика Home Assistant Discovery MQTT",
            "wb2ha node": "Элемент node в топике Home Assistant MQTT Discovery",
            "WB id": "Идентификатор контроллера WirenBoard для включения в идентификаторы устройств",
            "All devices and controls": "Опубликовать все устройства WirenBoard и их контролы",
            "Devices": "Устройства WirenBoard",
            "Select devices and controls": "Выберите устройства и контролы WirenBoard, которые надо опубликовать или исключить из публикации в HomeAssistant",
            "Publish all devices and controls": "Если установлена галочка, все контролы всех устройств WirenBoard будут добавлены в Home Assistant, за исключением невыбранных контролов в устройствах, помеченных галочкой \"Все не добавлять\".<br/>Если галочка не установлена, будут добавлены только измененные контролы, а также все контролы в устройствах, помеченных галочкой \"Добавить все\"",
            "If Unset": "Применить нижеуказаные опции, только если они не установлены другими модификаторами"
        },
        "en": {
            "WB unit modifiers": "MQTT Discovery Options to add for a control with this measurement unit",
            "WB unit name": "The abbreviated measurement unit name used in WirenBoard",
            "WB Units mods": "WirenBoard device controls and indicators modifiers applied automatically based on their measurement units",
            "Additional modifiers for readonly": "Additional modifiers for the read only controls",
            "Additional modifiers for writable": "Additional modifiers for the writable controls",
            "Controls to modify": "Which controls to modify when publish",
            "WB control modifiers": "MQTT Discovery Options to add for a control of this type",
            "WB control type name": "WirenBoard control or indicator name",
            "WB Control Types mods": "WirenBoard device controls and indicators modifiers applied automatically based on their types",
            "HA Name": "Name",
            "Name for HA": "Publish the control with this Home Assistant entity name",
            "Platform": "Type",
            "Options for HA Discovery in control": "Options for the Home Assistant MQTT Discovery message. Variables like {device.id}, {control.id}, {control.meta.units} may be used as well as the arbitrary variables that have to be defined for this control in the \"Variables\" section",
            "Options for HA Discovery in Named Mod": "Additional options for the Home Assistant MQTT Discovery message. Variables like {device.id}, {control.id}, {control.meta.units} may be used as well as the arbitrary variables that have to be defined for each control that uses this modifier",
            "HA Discovery Payload": "MQTT Discovery message payload",
            "Replace HA Type to this": "When activated, this Home Assistant \"Platform\" (generic device type) will be used",
            "These are named sets of options": "The named sets of options to add into the Home Assistant MQTT Discovery message payload",
            "Name of the modifier": "Modifier name to use wherever these MQTT Discovery options need to be added",
            "wb2ha Configuration": "wb2ha - Configuration of the WirenBoard devices and controls to display in Home Assistant",
            "Configure WB devices to add to HA": "Select the WirenBoard controls to publish in the Home Assistant MQTT Discovery topics using the \"WirenBoard Devices\" tab, optionally amending the payload. Use other tabs to configure the frequently used modifications",
            "HA root": "Home Assistant Discovery MQTT topic root",
            "wb2ha node": "WirenBoard To Home Assistant Discovery MQTT topic node element",
            "WB id": "WirenBoard controller identifier to include in the device identifiers",
            "All devices and controls": "Publish every WirenBoard device and control",
            "Devices": "WirenBoard Devices",
            "Select devices and controls": "Select which WirenBoard devices and controls to include or exclude from publishing in Home Assistant",
            "Publish all devices and controls": "When checked, all controls of every WirenBoard device will be published to Home Assistant, except the unselected controls of the devices marked with \"Don't include all\" checkbox.<br/>If unchecked, anly the modified controls will be added, plus all controls of the devices marked with \"Include all\" checkbox",
            "If Unset": "Apply the options below only if they are not set by other modifiers"
        }
    }
};
var CONFIG = {
    "all": false,
    "haroot": "homeassistant",
    "lists": {
        "controlTypes": [
            {
                "code": "sound_level",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "sound_pressure"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "dB"
                        }
                    ]
                }
            },
            {
                "code": "concentration",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "carbon_dioxide"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "ppm"
                        }
                    ]
                }
            },
            {
                "code": "rel_humidity",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "humidity"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "%"
                        }
                    ]
                }
            },
            {
                "code": "voltage",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "voltage"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "V"
                        }
                    ]
                }
            },
            {
                "code": "lux",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "illuminance"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "lx"
                        }
                    ]
                }
            },
            {
                "code": "temperature",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "temperature"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "°C"
                        }
                    ]
                }
            },
            {
                "code": "range",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "slider"
                            }
                        }
                    }
                }
            },
            {
                "code": "value",
                "value": {
                    "readonly": {
                        "ifUnset": {
                            "sensor": {
                                "unit_of_measurement": "%"
                            }
                        }
                    },
                    "writable": {
                        "mod": {
                            "number": {
                                "mode": "box"
                            }
                        }
                    }
                }
            },
            {
                "code": "switch",
                "value": {
                    "readonly": {
                        "mod": {
                            "binary_sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "switch": {}
                        }
                    },
                    "mod": [
                        {
                            "code": "payload_on",
                            "value": 1
                        },
                        {
                            "code": "payload_off",
                            "value": 0
                        }
                    ]
                }
            },
            {
                "code": "alarm",
                "value": {
                    "readonly": {
                        "mod": {
                            "binary_sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "switch": {}
                        }
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "problem"
                        },
                        {
                            "code": "payload_on",
                            "value": 1
                        },
                        {
                            "code": "payload_off",
                            "value": 0
                        }
                    ]
                }
            },
            {
                "code": "text",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "text": {}
                        }
                    }
                }
            },
            {
                "code": "w1-id",
                "value": {
                    "readonly": {
                        "mod": {
                            "sensor": {}
                        }
                    },
                    "writable": {
                        "mod": {
                            "text": {}
                        }
                    }
                }
            },
            {
                "code": "rgb",
                "value": {
                    "mod": {
                        "light": {
                            "schema": "basic",
                            "command_topic": "/devices/{device.id}/controls/RGB Strip/on",
                            "rgb_state_topic": "/devices/{device.id}/controls/{control.id}",
                            "rgb_command_topic": "/devices/{device.id}/controls/{control.id}/on",
                            "rgb_value_template": "{{ value.split(';') | join(',') }}",
                            "rgb_command_template": "{{ red }};{{ green }};{{ blue }}",
                            "state_topic": "/devices/{device.id}/controls/RGB Strip",
                            "payload_on": "1",
                            "payload_off": "0"
                        }
                    }
                }
            },
            {
                "code": "pushbutton",
                "value": {
                    "mod": {
                        "button": {
                            "payload_press": "1"
                        }
                    }
                }
            }
        ],
        "devices": {
            "system": {
                "controls": {
                    "Current uptime": {},
                    "Short SN": {}
                },
                "reverse": false
            }
        },
        "namedModifiers": [
            {
                "code": "zigbeeSwitchLight",
                "value": {
                    "mod": {
                        "light": {
                            "availability": [
                                {
                                    "topic": "zigbee2mqtt/bridge/state",
                                    "value_template": "{{ value_json.state }}"
                                }
                            ],
                            "command_topic": "zigbee2mqtt/{device.id}/set",
                            "payload_off": "{ \"{control.id}\": \"OFF\" }",
                            "payload_on": "{ \"{control.id}\": \"ON\" }",
                            "schema": "basic",
                            "state_topic": "zigbee2mqtt/{device.id}",
                            "state_value_template": "{ \"{control.id}\": \"{{ value_json.{control.id} }}\" }"
                        }
                    }
                }
            },
            {
                "code": "wbLedSwitchLight",
                "value": {
                    "mod": {
                        "light": {
                            "brightness_command_topic": "/devices/{device.id}/controls/{control.id} Brightness/on",
                            "brightness_scale": 100,
                            "brightness_state_topic": "/devices/{device.id}/controls/{control.id} Brightness",
                            "schema": "basic"
                        }
                    }
                }
            }
        ],
        "units": [
            {
                "code": "ppb",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "volatile_organic_compounds_parts"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "ppb"
                        }
                    ]
                }
            },
            {
                "code": "₽",
                "value": {
                    "writable": {
                        "mod": [
                            {
                                "code": "step",
                                "value": 0.01
                            }
                        ]
                    },
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "monetary"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "RUR"
                        }
                    ]
                }
            },
            {
                "code": "%, RH",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "humidity"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "%"
                        }
                    ]
                }
            },
            {
                "code": "mbar",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "pressure"
                        }
                    ]
                }
            },
            {
                "code": "bar",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "pressure"
                        }
                    ]
                }
            },
            {
                "code": "deg C",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "temperature"
                        },
                        {
                            "code": "unit_of_measurement",
                            "value": "°C"
                        }
                    ]
                }
            },
            {
                "code": "V",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "voltage"
                        }
                    ]
                }
            },
            {
                "code": "W",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "power"
                        }
                    ]
                }
            },
            {
                "code": "kWh",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "energy"
                        }
                    ]
                }
            },
            {
                "code": "Hz",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "frequency"
                        }
                    ]
                }
            },
            {
                "code": "s",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "duration"
                        }
                    ]
                }
            },
            {
                "code": "ms",
                "value": {
                    "mod": [
                        {
                            "code": "device_class",
                            "value": "duration"
                        }
                    ]
                }
            }
        ]
    },
    "node": "w2h",
    "wbId": "12345"
};
