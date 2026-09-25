declare module "pdf-parse-fork" {
  interface PdfParseForkResult {
    text: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }

  function pdf(data: Buffer): Promise<PdfParseForkResult>;
  export default pdf;
}
