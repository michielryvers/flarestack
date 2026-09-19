import {readFile} from "node:fs/promises";
import {protocolVersion,releaseVersion} from "../src/alchemy/protocol.ts";
const {version,protocol}=await Bun.file(new URL("../version.json",import.meta.url)).json();
const root=new URL("../",import.meta.url);
function assert(value:boolean,message:string){if(!value)throw new Error(message);}
assert(releaseVersion===version && protocolVersion===protocol,"Worker contract differs from version.json");
for(const path of ["src/Directory.Build.props","templates/Flarestack.Templates/Flarestack.Templates.csproj"])
 assert((await readFile(new URL(path,root),"utf8")).includes(`<Version>${version}</Version>`),`${path}: release mismatch`);
assert((await Bun.file(new URL("src/alchemy/package.json",root)).json()).version===version,"npm release mismatch");
const pins=await readFile(new URL("Directory.Packages.props",root),"utf8");
for(const name of ["Flarestack.D1","Flarestack.Authentication","Flarestack.Email","Aspire.Hosting.Flarestack"])
 assert(pins.includes(`Include="${name}" Version="${version}"`),`${name}: release mismatch`);
assert((await readFile(new URL("src/Shared/Protocol.cs",root),"utf8")).includes(`Version = "${protocol}"`),".NET protocol mismatch");
const infra=await Bun.file(new URL("samples/Todo/infra/package.json",root)).json();
assert(infra.flarestack.release===version&&infra.flarestack.protocol===protocol,"Infrastructure contract mismatch");
const hosting=await readFile(new URL("src/Aspire.Hosting.Flarestack/FlarestackHosting.cs",root),"utf8");
assert(hosting.includes(`GetInt32() != ${protocol}`)&&hosting.includes(`GetString() != "${version}"`),"Hosting contract mismatch");

console.log(`Release ${version}, protocol ${protocol}: package set agrees.`);
