declare module "heic-convert" {
  type Options = { buffer: Buffer | ArrayBuffer | Uint8Array; format: "JPEG" | "PNG"; quality?: number };
  const convert: (opts: Options) => Promise<ArrayBuffer | Buffer>;
  export default convert;
}
