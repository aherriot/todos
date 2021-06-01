import { kdf, verify } from "../crypto";
const crypto = require("crypto");

const HASH =
  "efbfbd48efbfbd392b140defbfbd:0cc3eeeacd171b9b80ab9557759b8cdc321a15a8883e0311c40c1c13e1109de889f07a8896adb9b261347d63b2eb390c2af00339b08789b3e0ef0b6355a5c4e2";

describe("kdf", () => {
  it("computes hash for simple password", async () => {
    const randomBytesMock = jest
      .spyOn(crypto, "randomBytes")
      .mockImplementation(() => Buffer.from("�H�9+\u0014\r�", "utf8"));

    const hash = await kdf("password");
    expect(randomBytesMock).toBeCalled();
    expect(hash).toBe(HASH);
  });

  it("computes different hashes for same password", async () => {
    jest
      .spyOn(crypto, "randomBytes")
      .mockImplementationOnce(() => Buffer.from("�H�9+\u0014\r�", "utf8"))
      .mockImplementationOnce(() => Buffer.from("��T��|E.", "utf8"));

    const hash = await kdf("password");
    const hash2 = await kdf("password");
    expect(hash).not.toBe(hash2);
  });

  it("computes different hashes for different passwords", async () => {
    jest
      .spyOn(crypto, "randomBytes")
      .mockImplementation(() => Buffer.from("�H�9+\u0014\r�", "utf8"));

    const hash = await kdf("password");
    const hash2 = await kdf("password2");
    expect(hash).not.toBe(hash2);
  });
});

describe("verify", () => {
  it("verifies correct password", async () => {
    const result = await verify("password", HASH);
    expect(result).toBe(true);
  });

  it("rejects incorrect password", async () => {
    const result = await verify("password2", HASH);
    expect(result).toBe(false);
  });

  it("rejects empty string hash", async () => {
    const result = await verify("password", "");
    expect(result).toBe(false);
  });

  it("rejects bad hash", async () => {
    const result = await verify("password", HASH.substr(0, 50));
    expect(result).toBe(false);
  });
});
