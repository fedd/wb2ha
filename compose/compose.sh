#! /bin/bash
cat $(dirname "$0")/../src/wb2ha.main.js > $(dirname "$0")/../release/wb2ha.js
echo "var SCHEMA = " >> $(dirname "$0")/../release/wb2ha.js
cat $(dirname "$0")/../src/wb2ha.schema.json >> $(dirname "$0")/../release/wb2ha.js
echo "; var CONFIG = " >> $(dirname "$0")/../release/wb2ha.js
cat $(dirname "$0")/../src/wb2ha.config.json >> $(dirname "$0")/../release/wb2ha.js
echo ";" >> $(dirname "$0")/../release/wb2ha.js



