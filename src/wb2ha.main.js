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

