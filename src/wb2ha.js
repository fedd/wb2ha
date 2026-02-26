/* global log */

// Convert Wirenboard metas to Home Assistant MQTT Discovery configs.
// A Wirenboard rule.
// Author: fedd@vsetec.com

var CONFIGFILENAME = "/etc/wb-rules/wb2ha.config.json";
var LISTFILENAME = "/etc/wb-rules/wb2ha.list.json";

var cfg;
var list;
var allControls;
var devices = {};
var inotifyIsWorking = false;

_loadConfig();

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

    // process the devices found so far
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
            devices[deviceId].controls[controlId].processed = true;
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

    // havent encountered a device yet
    if (devices[deviceId].meta) {
        _process(deviceId, controlId);
    }
});

function _process(deviceId, controlId) {

    var device = devices[deviceId];

    if (device.skipped) {
        return;
    }

    if (list.exclude[deviceId]) {
        device.skipped = true;
        debug("wb2ha: excluding device {} as per config", deviceId);
        return;
    }

    var control = device.controls[controlId];

    if (control.processed) {
        return;
    }
    control.processed = true;

    if (list.exclude[deviceId + "/" + controlId]) {
        control.skipped = true;
        debug("wb2ha: skipping control {} as per config", controlId);
        return;
    }

    var mods = list.modify[deviceId];
    if (!mods) {
        if (list.only) {
            device.skipped = true;
            debug("wb2ha: skipping unincluded device {} ", deviceId);
            return;
        } else {
            mods = {};
            list.modify[deviceId] = mods;
        }
    }
    mods = mods[controlId];
    if (!mods) {
        if (list.only && !allControls[deviceId]) {
            control.skipped = true;
            debug("wb2ha: skipping unincluded control {}", controlId);
            return;
        } else {
            mods = {};
            mods[controlId] = mods;
        }
    }
    mods = mods.namedModifiers ? mods.namedModifiers : null; // modifier names for our control, may be omitted

    // collect all modifiers into one modifier object
    // initialise it with common values
    control.discovery = {
        device: {
            identifiers: [device.idSmall, deviceId],
            manufacturer: "WirenBoard",
            name: deviceId
        },
        origin: {
            "name": "wb2ha",
            "sw": "0.1",
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
        unique_id: device.idSmall + "_" + control.idSmall
//        object_id: device.idSmall + "_" + control.idSmall, // deprecated
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
        _copyTypeModRW(control, cfg.units[control.meta.units]);
    }
    // deduce mods from type
    if (control.meta.type) {
        _copyTypeModRW(control, cfg.controlTypes[control.meta.type]);
    }

    // take modifiers from named mods
    if (mods) {
        for (var mod in mods) {
            _copyTypeModRW(control, list.namedModifiers[mods[mod]]);
        }
    }

    // lastly, take our own mod which will overwrite everything
    _copyTypeModRW(control, list.modify[deviceId][controlId]);

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
    control.discovery.default_entity_id = control.type + "." + device.idSmall + "_" + control.idSmall;

    control.topic =
            cfg.haroot + "/" +
            control.type + "/" +
            cfg.node + "/" +
            device.idSmall + "_" +
            control.idSmall + "/config";

    // replace all {var}, {device.id} and {control.meta.enum...} placeholders
    _poorMansTemplater(control, device);

    log("wb2ha: publishing control {} to {}", control.id, control.topic);
    publish(control.topic, JSON.stringify(control.discovery), 2, true);

}

setInterval(function () {
    if (!inotifyIsWorking) {
        inotifyIsWorking = true;
        runShellCommand("inotifywait -e modify " + CONFIGFILENAME + " " + LISTFILENAME, {
            exitCallback: function () {
                inotifyIsWorking = false;
                log("wb2ha: config changed");

                _loadConfig();

                for (var deviceId in devices) { // devices are kept updated by trackMqtt
                    devices[deviceId].skipped = false;
                    for (var controlId in devices[deviceId].controls) {
                        if (devices[deviceId].controls[controlId].topic) {
                            log("wb2ha: UNpublishing control {} from {} before reprocessing", controlId,
                                    devices[deviceId].controls[controlId].topic);
                            publish(devices[deviceId].controls[controlId].topic, "", 2, true);
                        }
                        // prepare to reprocess
                        devices[deviceId].controls[controlId].processed = false;
                        devices[deviceId].controls[controlId].skipped = false;
                        delete devices[deviceId].controls[controlId].type;

                        // reprocess
                        _process(deviceId, controlId);
                    }
                }
            }
        });
    }
}, 1000 * 30);  // rerun the config file watcher

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

function _loadConfig() {
    allControls = {};
    cfg = readConfig(CONFIGFILENAME);
    list = readConfig(LISTFILENAME);

    if (!list.modify) {
        list.modify = {};
    }

    var toAdd = {};
    var toDelete = [];
    // unwrap modified device list
    for (var i in list.modify) {
        var splitted = i.split("/");

        if (splitted.length === 2) { // "device/control" notation
            toDelete.push(i);
            // transform the bare string or array
            list.modify[i] = _stringOrArrayToMods(list.modify[i]);

            toAdd[splitted[0]] = list.modify[splitted[0]];
            if (toAdd[splitted[0]]) {// we have such a device
                if (toAdd[splitted[0]][splitted[1]]) { // and even control
                    // transform a possible string
                    toAdd[splitted[0]][splitted[1]] = _stringOrArrayToMods(toAdd[splitted[0]][splitted[1]]);
                    // merge what we have with what we had
                    _copyTypeMod(toAdd[splitted[0]][splitted[1]], toAdd[splitted[0]][splitted[1]].mod, list.modify[i], true);
                } else {
                    // there wasn't anything. put what we have
                    toAdd[splitted[0]][splitted[1]] = list.modify[i];
                }
            } else { // we have no such device, create
                toAdd[splitted[0]] = {};
                // and put what we have there
                toAdd[splitted[0]][splitted[1]] = list.modify[i];
            }
        } else if (splitted.length > 2) {
            log.error("wb2ha: wrong \"modify\" entry: {}", i);
        }
    }

    // now delete the todeletes
    for (var i in toDelete) {
        delete list.modify[toDelete[i]];
    }
    // now add the toadds
    for (var i in toAdd) {
        list.modify[i] = toAdd[i];
    }
    // now walk through for the last time and convert strings to arrays
    for (var i in list.modify) {
        for (var j in list.modify[i]) {
            list.modify[i][j] = _stringOrArrayToMods(list.modify[i][j]);
        }
    }

    // rework includeds
    if (list.only) {
        for (var i in list.only) {
            var splitted = list.only[i].split("/");
            if (splitted.length === 1) { // all controls
                allControls[splitted[0]] = true;
                // also add to mods without controls
                if (!list.modify[splitted[0]]) {
                    list.modify[splitted[0]] = {};
                }
            } else { // only select controls. just add to mods.
                if (splitted.length !== 2) {
                    log.error("wb2ha: wrong \"only\" entry: {}", list.only[i]);
                } else {
                    if (!list.modify[splitted[0]]) {
                        list.modify[splitted[0]] = {};
                    }
                    if (!list.modify[splitted[0]][splitted[1]]) {
                        list.modify[splitted[0]][splitted[1]] = {};
                    }
                }
            }
        }
    }
}

function _copyTypeMod(dest, mod, src, includeNamedModifiers) {
    if (src.type) {
        dest.type = src.type;
    }
    if (src.var) {
        if (!dest.var) {
            dest.var = {};
        }
        for (var mi in src.var) {
            dest.var[mi] = src.var[mi];
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
            mod[mi] = src.mod[mi];
        }
    }
    if (src.ifUnset) {
        for (var mi in src.ifUnset) {
            if (mod[mi] === undefined) {
                mod[mi] = src.ifUnset[mi];
            }
        }
    }
}

function _copyTypeModRW(control, src) {
    var mod = control.discovery;
    if (src) {
        _copyTypeMod(control, mod, src);
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

function _poorMansRetriever(obj, str) {
    var pos = str.indexOf(".");
    if (pos <= 0) {
        return obj[str];
    } else {
        return _poorMansRetriever(obj[str.slice(0, pos)], str.slice(pos + 1));
    }
}

function _poorMansTemplater(control, device) {
    var str = JSON.stringify(control.discovery);
    var placeholders = str.match(/\{[A-Za-z0-9_\.]+\}/g);
    if (!placeholders) {
        return;
    }
    var replacements = {};
    var occurences = {}; // no replaceAll method, so we'll count
    // find values for all placeholders
    for (var i in placeholders) {
        if (replacements[placeholders[i]]) {
            occurences[placeholders[i]]++;
        } else {
            occurences[placeholders[i]] = 1;
            var p = placeholders[i].slice(1, -1); // strip curlies
            //debug("wb2ha: {} p={}", placeholders[i], p);

            if (control.var[p]) {// if present in vars as is

                replacements[placeholders[i]] = control.var[p];

            } else {
                var variable = p.slice(0, placeholders[i].indexOf(".") - 1);
                var obj;
                //debug("{} p={} variable={}", placeholders[i], p, variable);
                var retain = false;
                switch (variable) {
                    case "device":
                        obj = device;
                        break;
                    case "control":
                        obj = control;
                        break;
                    case "config":
                        obj = cfg;
                        break;
                    case "list":
                        obj = list;
                        break;
                    case "devices":
                        obj = devices;
                        break;
                    default:
                        replacements[placeholders[i]] = placeholders[i]; // retain
                        retain = true;
                        break;  // ?
                }
                if (!retain) {
                    replacements[placeholders[i]] =
                            _poorMansRetriever(obj, p.slice(variable.length + 1));
                }
            }
            //debug("made {} for {}", replacements[placeholders[i]], placeholders[i]);
        }
    }

    // now replace all placeholders with those values
    //debug("replacements: {}", JSON.stringify(replacements));
    for (var p in replacements) {
        //debug("replacing p {} with {}", p, replacements[p]);
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
