import { access, cp } from "node:fs/promises";
import path from "node:path";

// Next traces server dependencies, but deliberately leaves public and static
// assets out of standalone. Make the artifact self-contained for Hostinger.
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
await access(path.join(standalone, "server.js"));
await cp(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
await cp(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  {
    recursive: true,
  }
);
console.log(
  "Standalone server packaged with public, CSS and JavaScript assets."
);
