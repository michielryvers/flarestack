declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string | ReadableStream<Uint8Array>);
    readonly from: string;
    readonly to: string;
  }
}
