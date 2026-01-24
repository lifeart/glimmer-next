import { render } from "../dist/server/server.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const self = import.meta.url;
const currentPath = path.dirname(fileURLToPath(self));
const SSR_MARK = "<!--ssr-outlet-->";
const indexPath = path.join(currentPath, "..", "dist", "index.html");

const result = await render("http://localhost:5173/");

const tpl = fs.readFileSync(indexPath, "utf8");
const updatedTpl = tpl.replace(SSR_MARK, result);
fs.writeFileSync(indexPath, updatedTpl, "utf8");

// Exit explicitly since lazy imports may leave pending async operations
process.exit(0);
