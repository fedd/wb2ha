#!/usr/bin/env node
/* global __dirname */
const fs = require('fs');
const path = require('path');

try {

    const wbSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/wb2ha.schema.json'), 'utf8'));
    // add the typed mods
    wbSchema.definitions.typedMod.oneOf.push(...JSON.parse(fs.readFileSync(path.resolve(__dirname, 'typedModOneOf.json'), 'utf8')));

    const newDefs = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'typedModDefs.json'), 'utf8'));
    for (const ref in newDefs) {
        if (!wbSchema.definitions[ref]) {
            wbSchema.definitions[ref] = newDefs[ref];
        }
    }

    // create the release
    fs.writeFileSync(path.resolve(__dirname, '../release/wb2ha.js'),
            fs.readFileSync(path.resolve(__dirname, '../src/wb2ha.main.js'), 'utf8') +
            "\nvar SCHEMA = " +
            JSON.stringify(wbSchema, null, 4) +
            ";\nvar CONFIG = " +
            fs.readFileSync(path.resolve(__dirname, '../src/wb2ha.config.json'), 'utf8') +
            ";\n", 'utf8');

} catch (err) {
    console.error('Error creating release:', err);
}