/** Reject copied service instructions instead of silently rewriting the developer's document. */
export function assertDocumentWithoutProtocol(content: string): void {
  if (/^\s*(?:#{1,6}\s+)?Plangent (?:protocol \(do not remove\)|agent instructions)\s*#*\s*$/im.test(content)) {
    throw new Error('The document contains Plangent agent instructions. Remove the service protocol block, preserve the document text, and submit the complete document again. Instructions from the format field are not document content.');
  }
}
