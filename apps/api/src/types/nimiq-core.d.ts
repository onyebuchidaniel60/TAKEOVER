// Minimal ambient typing for the @nimiq/core surface used by the test oracle
// (test/nimiq-oracle.test.ts) ONLY. Production code must never import this
// package: verification stays dependency-light (tweetnacl + noble) and offline.
// Runtime resolution is handled by Node/Vite via the package exports map.
declare module '@nimiq/core' {
  export class PublicKey {
    constructor(bytes: Uint8Array);
    serialize(): Uint8Array;
    toAddress(): Address;
    verify(signature: Signature, data: Uint8Array): boolean;
  }
  export class PrivateKey {
    serialize(): Uint8Array;
  }
  export class KeyPair {
    readonly publicKey: PublicKey;
    readonly privateKey: PrivateKey;
    static generate(): KeyPair;
  }
  export class Signature {
    static deserialize(bytes: Uint8Array): Signature;
    serialize(): Uint8Array;
    static create(privateKey: PrivateKey, publicKey: PublicKey, data: Uint8Array): Signature;
  }
  export class Address {
    toUserFriendlyAddress(): string;
  }
  export class Hash extends Uint8Array {
    static computeSha256(data: Uint8Array): Hash;
  }
  export const BufferUtils: {
    fromUtf8(text: string): Uint8Array;
  };
}
