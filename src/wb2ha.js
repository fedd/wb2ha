// Convert Wirenboard metas to Home Assistant MQTT Discovery configs

var cfg = readConfig("/etc/wb-rules/wb2ha.config.json");
var list = readConfig("/etc/wb-rules/wb2ha.list.json");

var devices = {};

// rework includeds
var allControls = {};
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
                log("wb2ha: wrong include: {}", list.only[i]);
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

    for (var controlId in devices[deviceId].controls) {
        process(deviceId, controlId);
    }

});

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
        processed: false//,
//        published: false,
//        remove: false
    };

    if (devices[deviceId].meta) {
        process(deviceId, controlId);
    }
});

// track the control metas
function process(deviceId, controlId) {


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
        if (!list.only) {
            mods = {};
            list.modify[deviceId] = mods;
        } else {
            device.skipped = true;
            debug("wb2ha: skipping unincluded device {} ", deviceId);
            return;
        }
    }
    mods = mods[controlId];
    if (!mods) {
        if (!list.only || allControls[deviceId]) {
            mods = {};
            mods[controlId] = mods;
        } else {
            control.skipped = true;
            debug("wb2ha: skipping unincluded control {}", controlId);
            return;
        }
    }
    mods = mods.mods ? mods.mods : null; // modifier names for our control, may be omitted

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
        unique_id: device.idSmall + "_" + control.idSmall,
        object_id: device.idSmall + "_" + control.idSmall
    };

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
        _copyTypeModRW(control, control.discovery, cfg.units[control.meta.units]);
    }
    // deduce mods from type
    if (control.meta.type) {
        _copyTypeModRW(control, control.discovery, cfg.controlTypes[control.meta.type]);
    }

    // take modifiers from class mods
    if (mods) {
        for (var mod in mods) {
            _copyTypeModRW(control, control.discovery, list.mods[mods[mod]]);
        }
    }

    // lastly, take our own mod which will overwrite everything
    _copyTypeModRW(control, control.discovery, list.modify[deviceId][controlId]);

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

    control.topic =
            cfg.haroot + "/" +
            control.type + "/" +
//            cfg.node + "/" +
            device.idSmall + "/" +
            control.idSmall + "/config";

    // replace all {device.id} and {control.meta.enum...} placeholders
    _poorMansTemplater(control.discovery, device, control);

    log("wb2ha: publishing control {} to {}", control.id, control.topic);
    publish(control.topic, JSON.stringify(control.discovery), 2, true);

}

//////////////////////////////////////////////////////////////////

function _copyTypeMod(control, mod, src) {
    if (src.type) {
        control.type = src.type;
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

function _copyTypeModRW(control, mod, src) {
    if (src) {
        _copyTypeMod(control, mod, src);
        if (control.meta.readonly) {
            if (src.readonly) {
                _copyTypeMod(control, mod, src.readonly);
            }
        } else {
            if (src.writable) {
                _copyTypeMod(control, mod, src.writable);
            }
        }
    }
}

//control.meta.max
//meta.max
function _poorMansRetriever(obj, str) {
    var pos = str.indexOf(".");
    if (pos <= 0) {
        return obj[str];
    } else {
        return _poorMansRetriever(obj[str.slice(0, pos)], str.slice(pos + 1));
    }
}

function _poorMansTemplater(discovery, device, control) {
    var str = JSON.stringify(discovery);
    var placeholders = str.match(/\{[A-Za-z0-9_]+\.[A-Za-z0-9_\.]+\}/g);
    if (!placeholders) {
        return;
    }
    var replacements = {};
    var occurences = {}; // no replaceAll method, well count
    // find values for all placeholders
    for (var i in placeholders) {
        if (replacements[placeholders[i]]) {
            occurences[placeholders[i]]++;
        } else {
            occurences[placeholders[i]] = 1;
            var p = placeholders[i].slice(1, -1);
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
                    //continue;
                    retain = true;
                    break;  // ?
            }
            if (!retain) {
                replacements[placeholders[i]] =
                        _poorMansRetriever(obj, p.slice(variable.length + 1));
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
        discovery[p] = str[p]; // no idea if es5 has anything wiser
    }
}
