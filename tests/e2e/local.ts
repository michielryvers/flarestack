import {readFileSync} from "node:fs";
import {existsSync} from "node:fs";
const local = {...JSON.parse(readFileSync("samples/Todo/local.json","utf8")),...(existsSync("samples/Todo/local.machine.json") ? JSON.parse(readFileSync("samples/Todo/local.machine.json","utf8")) : {})};
export const origin: string = process.env.PUBLIC_ORIGIN ?? local.publicOrigin;
export const inboxUrl = `http://127.0.0.1:${local.inboxPort ?? 8810}`;
