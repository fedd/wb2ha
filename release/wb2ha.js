/* global log */

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

                // take the devices snapshot and populate the devices in schema
                var i = 0;
                var devIds = Object.keys(devices);
                devIds.sort();
                for (var devId in devIds) {
                    i++;
                    // add device
                    SCHEMA.properties.
                            lists.
                            properties.
                            devices.
                            properties[devId] = {
                        "title": "Device " + devId,
                        "propertyOrder": i,
                        "$ref": "#/definitions/device",
                        "properties": {
                            "controls": {
                                "properties": {}
                            }
                        }
                    };

                    // device title translations
                    var titles = devices[devId].meta.title;
                    if (typeof titles === 'string' || titles instanceof String) {
                        if (devId !== titles) {
                            SCHEMA.properties.
                                    lists.
                                    properties.
                                    devices.
                                    properties[devId].title = devId + " (" + titles + ")";
                        }
                    } else {
                        for (var lang in titles) {
                            if (!SCHEMA.translations[lang]) {
                                SCHEMA.translations[lang] = {};
                            }
                            SCHEMA.translations[lang][SCHEMA.properties.
                                    lists.
                                    properties.
                                    devices.
                                    properties[devId].title] = devId + " (" + titles[lang] + ")";
                        }
                    }

                    //add controls
                    var j = 0;
                    var ctrIds = Object.keys(devices[devId].controls);
                    ctrIds.sort();
                    for (var ctrId in ctrIds) {
                        j++;
                        SCHEMA.properties.
                                lists.
                                properties.
                                devices.
                                properties[devId].
                                properties.
                                controls.
                                properties[ctrId] = {
                            "propertyOrder": j,
                            "$ref": "#/definitions/control"
                        };
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
            "sw": "0.2",
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
        dest.name = src.name;
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
        for (var mi in src.mod) {
            mod[src.mod[mi].code] = src.mod[mi].value;
        }
    }
    if (src.ifUnset) {
        for (var mi in src.ifUnset) {
            if (mod[src.ifUnset[mi].code] === undefined) {
                mod[src.ifUnset[mi].code] = src.ifUnset[mi].value;
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

var SCHEMA = 
{
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
                                    "type": {
                                        "propertyOrder": 10,
                                        "options": {
                                            "grid_columns": 2,
                                            "show_opt_in": true
                                        },
                                        "$ref": "#/definitions/type"
                                    },
                                    "mod": {
                                        "options": {
                                            "grid_columns": 7
                                        },
                                        "description": "Options for HA Discovery in Named Mod",
                                        "propertyOrder": 20,
                                        "$ref": "#/definitions/mod"
                                    },
                                    "namedModifiers": {
                                        "_format": "table",
                                        "options": {
                                            "grid_columns": 3,
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
                "type": {
                    "propertyOrder": 10,
                    "options": {
                        "grid_columns": 2,
                        "show_opt_in": true
                    },
                    "description": "",
                    "$ref": "#/definitions/type"
                },
                "mod": {
                    "options": {
                        "grid_columns": 7,
                        "show_opt_in": true
                    },
                    "description": "",
                    "propertyOrder": 20,
                    "$ref": "#/definitions/mod"
                },
                "namedModifiers": {
                    "_format": "table",
                    "options": {
                        "grid_columns": 3,
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
                "controls": {
                },
                "reverse": true
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
                "type": {
                    "propertyOrder": 10,
                    "options": {
                        "grid_columns": 2,
                        "show_opt_in": true
                    },
                    "$ref": "#/definitions/type"
                },
                "namedModifiers": {
                    "_format": "table",
                    "options": {
                        "grid_columns": 4,
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
                    "$ref": "#/definitions/mod"
                },
                "var": {
                    "options": {
                        "grid_columns": 4,
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
        "type": {
            "title": "Platform",
            "description": "Replace HA Type to this",
            "type": "string",
            "enum": [
                "button",
                "cover",
                "climate",
                "sensor",
                "binary_sensor",
                "number",
                "fan",
                "text",
                "select",
                "switch",
                "valve",
                "light"
            ]
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
            "{{if rootAll == \"true\" }}Don't include all{{else}}Include all{{endif}}":
                    "{{if rootAll == \"true\" }}Все не добавлять{{else}}Добавить все{{endif}}",
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
            "Publish all devices and controls": "Если установлена галочка, все контролы всех устройств WirenBoard будут добавлены в Home Assistant, за исключением невыбранных контролов в устройствах, помеченных галочкой \"Все не добавлять\".<br/>Если галочка не установлена, будут добавлены только измененные контролы, а также все контролы в устройствах, помеченных галочкой \"Добавить все\""
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
            "HA root": "Home Assistant Discovery MQTT topic root!",
            "wb2ha node": "WirenBoard To Home Assistant Discovery MQTT topic node element",
            "WB id": "WirenBoard controller identifier to include in the device identifiers",
            "All devices and controls": "Publish every WirenBoard device and control",
            "Devices": "WirenBoard Devices",
            "Select devices and controls": "Select which WirenBoard devices and controls to include or exclude from publishing in Home Assistant",
            "Publish all devices and controls": "When checked, all controls of every WirenBoard device will be published to Home Assistant, except the unselected controls of the devices marked with \"Don't include all\" checkbox.<br/>If unchecked, anly the modified controls will be added, plus all controls of the devices marked with \"Include all\" checkbox"
        }
    }
}; var CONFIG = 
{
    "all": false,
    "haroot": "homeassistant",
    "lists": {
        "controlTypes": [
            {
                "code": "sound_level",
                "value": {
                    "readonly": {
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "slider"
                            }
                        ],
                        "type": "number"
                    }
                }
            },
            {
                "code": "value",
                "value": {
                    "readonly": {
                        "type": "sensor",
                        "ifUnset": [
                            {
                                "code": "unit_of_measurement",
                                "value": "%"
                            }
                        ]
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "mode",
                                "value": "box"
                            }
                        ],
                        "type": "number"
                    }
                }
            },
            {
                "code": "switch",
                "value": {
                    "readonly": {
                        "type": "binary_sensor"
                    },
                    "writable": {
                        "type": "switch"
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
                        "type": "binary_sensor"
                    },
                    "writable": {
                        "type": "switch"
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
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "platform",
                                "value": "text"
                            }
                        ],
                        "type": "text"
                    }
                }
            },
            {
                "code": "w1-id",
                "value": {
                    "readonly": {
                        "type": "sensor"
                    },
                    "writable": {
                        "mod": [
                            {
                                "code": "platform",
                                "value": "text"
                            }
                        ],
                        "type": "text"
                    }
                }
            },
            {
                "code": "rgb",
                "value": {
                    "writable": {
                        "mod": [
                            {
                                "code": "command_topic",
                                "value": "/devices/{device.id}/controls/RGB Strip/on"
                            }
                        ]
                    },
                    "mod": [
                        {
                            "code": "rgb_state_topic",
                            "value": "/devices/{device.id}/controls/{control.id}"
                        },
                        {
                            "code": "rgb_command_topic",
                            "value": "/devices/{device.id}/controls/{control.id}/on"
                        },
                        {
                            "code": "rgb_value_template",
                            "value": "{{ value.split(';') | join(',') }}"
                        },
                        {
                            "code": "rgb_command_template",
                            "value": "{{ red }};{{ green }};{{ blue }}"
                        },
                        {
                            "code": "state_topic",
                            "value": "/devices/{device.id}/controls/RGB Strip"
                        },
                        {
                            "code": "payload_on",
                            "value": 1
                        },
                        {
                            "code": "payload_off",
                            "value": 0
                        }
                    ],
                    "type": "light"
                }
            },
            {
                "code": "pushbutton",
                "value": {
                    "mod": [
                        {
                            "code": "payload_press",
                            "value": 1
                        }
                    ],
                    "type": "button"
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
        "namedModifiers": [],
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
