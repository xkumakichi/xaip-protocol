// Prepends #!/usr/bin/env node to dist/index.js so it can be executed directly via npx.
// .cjs so it runs in CommonJS even when package.json has "type":"module".
const fs = require("fs");
const f = "dist/index.js";
const current = fs.readFileSync(f, "utf8");
if (!current.startsWith("#!/usr/bin/env node")) {
  fs.writeFileSync(f, "#!/usr/bin/env node\n" + current);
}
