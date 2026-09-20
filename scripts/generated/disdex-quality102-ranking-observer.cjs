"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod2) => function __require() {
  return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// ../-ai-dex-manager/node_modules/dotenv/package.json
var require_package = __commonJS({
  "../-ai-dex-manager/node_modules/dotenv/package.json"(exports2, module2) {
    module2.exports = {
      name: "dotenv",
      version: "17.3.1",
      description: "Loads environment variables from .env file",
      main: "lib/main.js",
      types: "lib/main.d.ts",
      exports: {
        ".": {
          types: "./lib/main.d.ts",
          require: "./lib/main.js",
          default: "./lib/main.js"
        },
        "./config": "./config.js",
        "./config.js": "./config.js",
        "./lib/env-options": "./lib/env-options.js",
        "./lib/env-options.js": "./lib/env-options.js",
        "./lib/cli-options": "./lib/cli-options.js",
        "./lib/cli-options.js": "./lib/cli-options.js",
        "./package.json": "./package.json"
      },
      scripts: {
        "dts-check": "tsc --project tests/types/tsconfig.json",
        lint: "standard",
        pretest: "npm run lint && npm run dts-check",
        test: "tap run tests/**/*.js --allow-empty-coverage --disable-coverage --timeout=60000",
        "test:coverage": "tap run tests/**/*.js --show-full-coverage --timeout=60000 --coverage-report=text --coverage-report=lcov",
        prerelease: "npm test",
        release: "standard-version"
      },
      repository: {
        type: "git",
        url: "git://github.com/motdotla/dotenv.git"
      },
      homepage: "https://github.com/motdotla/dotenv#readme",
      funding: "https://dotenvx.com",
      keywords: [
        "dotenv",
        "env",
        ".env",
        "environment",
        "variables",
        "config",
        "settings"
      ],
      readmeFilename: "README.md",
      license: "BSD-2-Clause",
      devDependencies: {
        "@types/node": "^18.11.3",
        decache: "^4.6.2",
        sinon: "^14.0.1",
        standard: "^17.0.0",
        "standard-version": "^9.5.0",
        tap: "^19.2.0",
        typescript: "^4.8.4"
      },
      engines: {
        node: ">=12"
      },
      browser: {
        fs: false
      }
    };
  }
});

// ../-ai-dex-manager/node_modules/dotenv/lib/main.js
var require_main = __commonJS({
  "../-ai-dex-manager/node_modules/dotenv/lib/main.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var os = require("os");
    var crypto2 = require("crypto");
    var packageJson = require_package();
    var version2 = packageJson.version;
    var TIPS = [
      "\u{1F510} encrypt with Dotenvx: https://dotenvx.com",
      "\u{1F510} prevent committing .env to code: https://dotenvx.com/precommit",
      "\u{1F510} prevent building .env in docker: https://dotenvx.com/prebuild",
      "\u{1F916} agentic secret storage: https://dotenvx.com/as2",
      "\u26A1\uFE0F secrets for agents: https://dotenvx.com/as2",
      "\u{1F6E1}\uFE0F auth for agents: https://vestauth.com",
      "\u{1F6E0}\uFE0F  run anywhere with `dotenvx run -- yourcommand`",
      "\u2699\uFE0F  specify custom .env file path with { path: '/custom/path/.env' }",
      "\u2699\uFE0F  enable debug logging with { debug: true }",
      "\u2699\uFE0F  override existing env vars with { override: true }",
      "\u2699\uFE0F  suppress all logs with { quiet: true }",
      "\u2699\uFE0F  write to custom object with { processEnv: myObject }",
      "\u2699\uFE0F  load multiple .env files with { path: ['.env.local', '.env'] }"
    ];
    function _getRandomTip() {
      return TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    function parseBoolean(value) {
      if (typeof value === "string") {
        return !["false", "0", "no", "off", ""].includes(value.toLowerCase());
      }
      return Boolean(value);
    }
    function supportsAnsi() {
      return process.stdout.isTTY;
    }
    function dim(text) {
      return supportsAnsi() ? `\x1B[2m${text}\x1B[0m` : text;
    }
    var LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
    function parse(src) {
      const obj = {};
      let lines = src.toString();
      lines = lines.replace(/\r\n?/mg, "\n");
      let match;
      while ((match = LINE.exec(lines)) != null) {
        const key = match[1];
        let value = match[2] || "";
        value = value.trim();
        const maybeQuote = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");
        if (maybeQuote === '"') {
          value = value.replace(/\\n/g, "\n");
          value = value.replace(/\\r/g, "\r");
        }
        obj[key] = value;
      }
      return obj;
    }
    function _parseVault(options) {
      options = options || {};
      const vaultPath = _vaultPath(options);
      options.path = vaultPath;
      const result = DotenvModule.configDotenv(options);
      if (!result.parsed) {
        const err = new Error(`MISSING_DATA: Cannot parse ${vaultPath} for an unknown reason`);
        err.code = "MISSING_DATA";
        throw err;
      }
      const keys = _dotenvKey(options).split(",");
      const length = keys.length;
      let decrypted;
      for (let i = 0; i < length; i++) {
        try {
          const key = keys[i].trim();
          const attrs = _instructions(result, key);
          decrypted = DotenvModule.decrypt(attrs.ciphertext, attrs.key);
          break;
        } catch (error) {
          if (i + 1 >= length) {
            throw error;
          }
        }
      }
      return DotenvModule.parse(decrypted);
    }
    function _warn(message) {
      console.error(`[dotenv@${version2}][WARN] ${message}`);
    }
    function _debug(message) {
      console.log(`[dotenv@${version2}][DEBUG] ${message}`);
    }
    function _log(message) {
      console.log(`[dotenv@${version2}] ${message}`);
    }
    function _dotenvKey(options) {
      if (options && options.DOTENV_KEY && options.DOTENV_KEY.length > 0) {
        return options.DOTENV_KEY;
      }
      if (process.env.DOTENV_KEY && process.env.DOTENV_KEY.length > 0) {
        return process.env.DOTENV_KEY;
      }
      return "";
    }
    function _instructions(result, dotenvKey) {
      let uri;
      try {
        uri = new URL(dotenvKey);
      } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
          const err = new Error("INVALID_DOTENV_KEY: Wrong format. Must be in valid uri format like dotenv://:key_1234@dotenvx.com/vault/.env.vault?environment=development");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        }
        throw error;
      }
      const key = uri.password;
      if (!key) {
        const err = new Error("INVALID_DOTENV_KEY: Missing key part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environment = uri.searchParams.get("environment");
      if (!environment) {
        const err = new Error("INVALID_DOTENV_KEY: Missing environment part");
        err.code = "INVALID_DOTENV_KEY";
        throw err;
      }
      const environmentKey = `DOTENV_VAULT_${environment.toUpperCase()}`;
      const ciphertext = result.parsed[environmentKey];
      if (!ciphertext) {
        const err = new Error(`NOT_FOUND_DOTENV_ENVIRONMENT: Cannot locate environment ${environmentKey} in your .env.vault file.`);
        err.code = "NOT_FOUND_DOTENV_ENVIRONMENT";
        throw err;
      }
      return { ciphertext, key };
    }
    function _vaultPath(options) {
      let possibleVaultPath = null;
      if (options && options.path && options.path.length > 0) {
        if (Array.isArray(options.path)) {
          for (const filepath of options.path) {
            if (fs.existsSync(filepath)) {
              possibleVaultPath = filepath.endsWith(".vault") ? filepath : `${filepath}.vault`;
            }
          }
        } else {
          possibleVaultPath = options.path.endsWith(".vault") ? options.path : `${options.path}.vault`;
        }
      } else {
        possibleVaultPath = path.resolve(process.cwd(), ".env.vault");
      }
      if (fs.existsSync(possibleVaultPath)) {
        return possibleVaultPath;
      }
      return null;
    }
    function _resolveHome(envPath) {
      return envPath[0] === "~" ? path.join(os.homedir(), envPath.slice(1)) : envPath;
    }
    function _configVault(options) {
      const debug = parseBoolean(process.env.DOTENV_CONFIG_DEBUG || options && options.debug);
      const quiet = parseBoolean(process.env.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (debug || !quiet) {
        _log("Loading env from encrypted .env.vault");
      }
      const parsed = DotenvModule._parseVault(options);
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      DotenvModule.populate(processEnv, parsed, options);
      return { parsed };
    }
    function configDotenv(options) {
      const dotenvPath = path.resolve(process.cwd(), ".env");
      let encoding = "utf8";
      let processEnv = process.env;
      if (options && options.processEnv != null) {
        processEnv = options.processEnv;
      }
      let debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || options && options.debug);
      let quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || options && options.quiet);
      if (options && options.encoding) {
        encoding = options.encoding;
      } else {
        if (debug) {
          _debug("No encoding is specified. UTF-8 is used by default");
        }
      }
      let optionPaths = [dotenvPath];
      if (options && options.path) {
        if (!Array.isArray(options.path)) {
          optionPaths = [_resolveHome(options.path)];
        } else {
          optionPaths = [];
          for (const filepath of options.path) {
            optionPaths.push(_resolveHome(filepath));
          }
        }
      }
      let lastError;
      const parsedAll = {};
      for (const path2 of optionPaths) {
        try {
          const parsed = DotenvModule.parse(fs.readFileSync(path2, { encoding }));
          DotenvModule.populate(parsedAll, parsed, options);
        } catch (e) {
          if (debug) {
            _debug(`Failed to load ${path2} ${e.message}`);
          }
          lastError = e;
        }
      }
      const populated = DotenvModule.populate(processEnv, parsedAll, options);
      debug = parseBoolean(processEnv.DOTENV_CONFIG_DEBUG || debug);
      quiet = parseBoolean(processEnv.DOTENV_CONFIG_QUIET || quiet);
      if (debug || !quiet) {
        const keysCount = Object.keys(populated).length;
        const shortPaths = [];
        for (const filePath of optionPaths) {
          try {
            const relative = path.relative(process.cwd(), filePath);
            shortPaths.push(relative);
          } catch (e) {
            if (debug) {
              _debug(`Failed to load ${filePath} ${e.message}`);
            }
            lastError = e;
          }
        }
        _log(`injecting env (${keysCount}) from ${shortPaths.join(",")} ${dim(`-- tip: ${_getRandomTip()}`)}`);
      }
      if (lastError) {
        return { parsed: parsedAll, error: lastError };
      } else {
        return { parsed: parsedAll };
      }
    }
    function config(options) {
      if (_dotenvKey(options).length === 0) {
        return DotenvModule.configDotenv(options);
      }
      const vaultPath = _vaultPath(options);
      if (!vaultPath) {
        _warn(`You set DOTENV_KEY but you are missing a .env.vault file at ${vaultPath}. Did you forget to build it?`);
        return DotenvModule.configDotenv(options);
      }
      return DotenvModule._configVault(options);
    }
    function decrypt(encrypted, keyStr) {
      const key = Buffer.from(keyStr.slice(-64), "hex");
      let ciphertext = Buffer.from(encrypted, "base64");
      const nonce = ciphertext.subarray(0, 12);
      const authTag = ciphertext.subarray(-16);
      ciphertext = ciphertext.subarray(12, -16);
      try {
        const aesgcm = crypto2.createDecipheriv("aes-256-gcm", key, nonce);
        aesgcm.setAuthTag(authTag);
        return `${aesgcm.update(ciphertext)}${aesgcm.final()}`;
      } catch (error) {
        const isRange = error instanceof RangeError;
        const invalidKeyLength = error.message === "Invalid key length";
        const decryptionFailed = error.message === "Unsupported state or unable to authenticate data";
        if (isRange || invalidKeyLength) {
          const err = new Error("INVALID_DOTENV_KEY: It must be 64 characters long (or more)");
          err.code = "INVALID_DOTENV_KEY";
          throw err;
        } else if (decryptionFailed) {
          const err = new Error("DECRYPTION_FAILED: Please check your DOTENV_KEY");
          err.code = "DECRYPTION_FAILED";
          throw err;
        } else {
          throw error;
        }
      }
    }
    function populate(processEnv, parsed, options = {}) {
      const debug = Boolean(options && options.debug);
      const override = Boolean(options && options.override);
      const populated = {};
      if (typeof parsed !== "object") {
        const err = new Error("OBJECT_REQUIRED: Please check the processEnv argument being passed to populate");
        err.code = "OBJECT_REQUIRED";
        throw err;
      }
      for (const key of Object.keys(parsed)) {
        if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
          if (override === true) {
            processEnv[key] = parsed[key];
            populated[key] = parsed[key];
          }
          if (debug) {
            if (override === true) {
              _debug(`"${key}" is already defined and WAS overwritten`);
            } else {
              _debug(`"${key}" is already defined and was NOT overwritten`);
            }
          }
        } else {
          processEnv[key] = parsed[key];
          populated[key] = parsed[key];
        }
      }
      return populated;
    }
    var DotenvModule = {
      configDotenv,
      _configVault,
      _parseVault,
      config,
      decrypt,
      parse,
      populate
    };
    module2.exports.configDotenv = DotenvModule.configDotenv;
    module2.exports._configVault = DotenvModule._configVault;
    module2.exports._parseVault = DotenvModule._parseVault;
    module2.exports.config = DotenvModule.config;
    module2.exports.decrypt = DotenvModule.decrypt;
    module2.exports.parse = DotenvModule.parse;
    module2.exports.populate = DotenvModule.populate;
    module2.exports = DotenvModule;
  }
});

// ../-ai-dex-manager/node_modules/dotenv/lib/env-options.js
var require_env_options = __commonJS({
  "../-ai-dex-manager/node_modules/dotenv/lib/env-options.js"(exports2, module2) {
    var options = {};
    if (process.env.DOTENV_CONFIG_ENCODING != null) {
      options.encoding = process.env.DOTENV_CONFIG_ENCODING;
    }
    if (process.env.DOTENV_CONFIG_PATH != null) {
      options.path = process.env.DOTENV_CONFIG_PATH;
    }
    if (process.env.DOTENV_CONFIG_QUIET != null) {
      options.quiet = process.env.DOTENV_CONFIG_QUIET;
    }
    if (process.env.DOTENV_CONFIG_DEBUG != null) {
      options.debug = process.env.DOTENV_CONFIG_DEBUG;
    }
    if (process.env.DOTENV_CONFIG_OVERRIDE != null) {
      options.override = process.env.DOTENV_CONFIG_OVERRIDE;
    }
    if (process.env.DOTENV_CONFIG_DOTENV_KEY != null) {
      options.DOTENV_KEY = process.env.DOTENV_CONFIG_DOTENV_KEY;
    }
    module2.exports = options;
  }
});

// ../-ai-dex-manager/node_modules/dotenv/lib/cli-options.js
var require_cli_options = __commonJS({
  "../-ai-dex-manager/node_modules/dotenv/lib/cli-options.js"(exports2, module2) {
    var re = /^dotenv_config_(encoding|path|quiet|debug|override|DOTENV_KEY)=(.+)$/;
    module2.exports = function optionMatcher(args) {
      const options = args.reduce(function(acc, cur) {
        const matches = cur.match(re);
        if (matches) {
          acc[matches[1]] = matches[2];
        }
        return acc;
      }, {});
      if (!("quiet" in options)) {
        options.quiet = "true";
      }
      return options;
    };
  }
});

// ../-ai-dex-manager/node_modules/dotenv/config.js
(function() {
  require_main().config(
    Object.assign(
      {},
      require_env_options(),
      require_cli_options()(process.argv)
    )
  );
})();

// scripts/disdex-quality102-ranking-observer.ts
var import_promises3 = require("node:fs/promises");
var import_node_path3 = require("node:path");

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/cryptoNode.js
var nc = __toESM(require("node:crypto"), 1);
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad2 = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad2);
    pad2 += a.length;
  }
  return res;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// ../-ai-dex-manager/node_modules/@noble/curves/esm/abstract/utils.js
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes2(item) {
  if (!isBytes2(item))
    throw new Error("Uint8Array expected");
}
function abool(title, value) {
  if (typeof value !== "boolean")
    throw new Error(title + " boolean expected, got " + value);
}
function numberToHexUnpadded(num) {
  const hex = num.toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
var hasHexBuiltin = (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
);
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes2(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes2(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function concatBytes2(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad2 = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad2);
    pad2 += a.length;
  }
  return res;
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
var u8n = (len) => new Uint8Array(len);
var u8fr = (arr) => Uint8Array.from(arr);
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  if (typeof hashLen !== "number" || hashLen < 2)
    throw new Error("hashLen must be a number");
  if (typeof qByteLen !== "number" || qByteLen < 2)
    throw new Error("qByteLen must be a number");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...b) => hmacFn(k, v, ...b);
  const reseed = (seed = u8n(0)) => {
    k = h(u8fr([0]), seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(u8fr([1]), seed);
    v = h();
  };
  const gen2 = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while (!(res = pred(gen2())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
var validatorFns = {
  bigint: (val) => typeof val === "bigint",
  function: (val) => typeof val === "function",
  boolean: (val) => typeof val === "boolean",
  string: (val) => typeof val === "string",
  stringOrUint8Array: (val) => typeof val === "string" || isBytes2(val),
  isSafeInteger: (val) => Number.isSafeInteger(val),
  array: (val) => Array.isArray(val),
  field: (val, object) => object.Fp.isValid(val),
  hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
};
function validateObject(object, validators, optValidators = {}) {
  const checkField = (fieldName, type, isOptional) => {
    const checkVal = validatorFns[type];
    if (typeof checkVal !== "function")
      throw new Error("invalid validator function");
    const val = object[fieldName];
    if (isOptional && val === void 0)
      return;
    if (!checkVal(val, object)) {
      throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
    }
  };
  for (const [fieldName, type] of Object.entries(validators))
    checkField(fieldName, type, false);
  for (const [fieldName, type] of Object.entries(optValidators))
    checkField(fieldName, type, true);
  return object;
}
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// ../-ai-dex-manager/node_modules/@noble/curves/esm/abstract/modular.js
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _8n = /* @__PURE__ */ BigInt(8);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function sqrt3mod4(Fp, n) {
  const p1div4 = (Fp.ORDER + _1n2) / _4n;
  const root = Fp.pow(n, p1div4);
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
  return root;
}
function sqrt5mod8(Fp, n) {
  const p5div8 = (Fp.ORDER - _5n) / _8n;
  const n2 = Fp.mul(n, _2n);
  const v = Fp.pow(n2, p5div8);
  const nv = Fp.mul(n, v);
  const i = Fp.mul(Fp.mul(nv, _2n), v);
  const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
  return root;
}
function tonelliShanks(P) {
  if (P < BigInt(3))
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    if (Fp.is0(n))
      return n;
    if (FpLegendre(Fp, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp.mul(Fp.ONE, cc);
    let t = Fp.pow(n, Q);
    let R = Fp.pow(n, Q1div2);
    while (!Fp.eql(t, Fp.ONE)) {
      if (Fp.is0(t))
        return Fp.ZERO;
      let i = 1;
      let t_tmp = Fp.sqr(t);
      while (!Fp.eql(t_tmp, Fp.ONE)) {
        i++;
        t_tmp = Fp.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp.pow(c, exponent);
      M = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "isSafeInteger",
    BITS: "isSafeInteger"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  return validateObject(field, opts);
}
function FpPow(Fp, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num;
  let p = Fp.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp.mul(p, d);
    d = Fp.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const p1mod2 = (Fp.ORDER - _1n2) / _2n;
  const powered = Fp.pow(n, p1mod2);
  const yes = Fp.eql(powered, Fp.ONE);
  const zero = Fp.eql(powered, Fp.ZERO);
  const no = Fp.eql(powered, Fp.neg(Fp.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLen2, isLE2 = false, redef = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, bitLen2);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE: isLE2,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: redef.sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE2 ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes) => {
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      return isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE2) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE2);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE2 ? 4 : 0;
  const l = isLE2 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE2);
  view.setUint32(byteOffset + l, wl, isLE2);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE2) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/hmac.js
var HMAC = class extends Hash {
  constructor(hash, _key) {
    super();
    this.finished = false;
    this.destroyed = false;
    ahash(hash);
    const key = toBytes(_key);
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad2 = new Uint8Array(blockLen);
    pad2.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad2.length; i++)
      pad2[i] ^= 54;
    this.iHash.update(pad2);
    this.oHash = hash.create();
    for (let i = 0; i < pad2.length; i++)
      pad2[i] ^= 54 ^ 92;
    this.oHash.update(pad2);
    clean(pad2);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    abytes(out, this.outputLen);
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
hmac.create = (hash, key) => new HMAC(hash, key);

// ../-ai-dex-manager/node_modules/@noble/curves/esm/abstract/curve.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function constTimeNegate(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function wNAF(c, bits) {
  return {
    constTimeNegate,
    hasPrecomputes(elm) {
      return getW(elm) !== 1;
    },
    // non-const time multiplication ladder
    unsafeLadder(elm, n, p = c.ZERO) {
      let d = elm;
      while (n > _0n3) {
        if (n & _1n3)
          p = p.add(d);
        d = d.double();
        n >>= _1n3;
      }
      return p;
    },
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param elm Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(elm, W) {
      const { windows, windowSize } = calcWOpts(W, bits);
      const points = [];
      let p = elm;
      let base = p;
      for (let window = 0; window < windows; window++) {
        base = p;
        points.push(base);
        for (let i = 1; i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    },
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n) {
      let p = c.ZERO;
      let f = c.BASE;
      const wo = calcWOpts(W, bits);
      for (let window = 0; window < wo.windows; window++) {
        const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
        n = nextN;
        if (isZero) {
          f = f.add(constTimeNegate(isNegF, precomputes[offsetF]));
        } else {
          p = p.add(constTimeNegate(isNeg, precomputes[offset]));
        }
      }
      return { p, f };
    },
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = c.ZERO) {
      const wo = calcWOpts(W, bits);
      for (let window = 0; window < wo.windows; window++) {
        if (n === _0n3)
          break;
        const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
        n = nextN;
        if (isZero) {
          continue;
        } else {
          const item = precomputes[offset];
          acc = acc.add(isNeg ? item.negate() : item);
        }
      }
      return acc;
    },
    getPrecomputes(W, P, transform) {
      let comp = pointPrecomputes.get(P);
      if (!comp) {
        comp = this.precomputeWindow(P, W);
        if (W !== 1)
          pointPrecomputes.set(P, transform(comp));
      }
      return comp;
    },
    wNAFCached(P, n, transform) {
      const W = getW(P);
      return this.wNAF(W, this.getPrecomputes(W, P, transform), n);
    },
    wNAFCachedUnsafe(P, n, transform, prev) {
      const W = getW(P);
      if (W === 1)
        return this.unsafeLadder(P, n, prev);
      return this.wNAFUnsafe(W, this.getPrecomputes(W, P, transform), n, prev);
    },
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    setWindowSize(P, W) {
      validateW(W, bits);
      pointWindowSizes.set(P, W);
      pointPrecomputes.delete(P);
    }
  };
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function validateBasic(curve) {
  validateField(curve.Fp);
  validateObject(curve, {
    n: "bigint",
    h: "bigint",
    Gx: "field",
    Gy: "field"
  }, {
    nBitLength: "isSafeInteger",
    nByteLength: "isSafeInteger"
  });
  return Object.freeze({
    ...nLength(curve.n, curve.nBitLength),
    ...curve,
    ...{ p: curve.Fp.ORDER }
  });
}

// ../-ai-dex-manager/node_modules/@noble/curves/esm/abstract/weierstrass.js
function validateSigVerOpts(opts) {
  if (opts.lowS !== void 0)
    abool("lowS", opts.lowS);
  if (opts.prehash !== void 0)
    abool("prehash", opts.prehash);
}
function validatePointOpts(curve) {
  const opts = validateBasic(curve);
  validateObject(opts, {
    a: "field",
    b: "field"
  }, {
    allowInfinityPoint: "boolean",
    allowedPrivateKeyLengths: "array",
    clearCofactor: "function",
    fromBytes: "function",
    isTorsionFree: "function",
    toBytes: "function",
    wrapPrivateKey: "boolean"
  });
  const { endo, Fp, a } = opts;
  if (endo) {
    if (!Fp.eql(a, Fp.ZERO)) {
      throw new Error("invalid endo: CURVE.a must be 0");
    }
    if (typeof endo !== "object" || typeof endo.beta !== "bigint" || typeof endo.splitScalar !== "function") {
      throw new Error('invalid endo: expected "beta": bigint and "splitScalar": function');
    }
  }
  return Object.freeze({ ...opts });
}
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = DER;
      let pos = 0;
      if (tag < 0 || tag > 256)
        throw new E("tlv.encode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = DER;
      if (num < _0n4)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = DER;
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(hex) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data = ensureBytes("signature", hex);
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = DER;
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
function numToSizedHex(num, size2) {
  return bytesToHex(numberToBytesBE(num, size2));
}
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function weierstrassPoints(opts) {
  const CURVE = validatePointOpts(opts);
  const { Fp } = CURVE;
  const Fn = Field(CURVE.n, CURVE.nBitLength);
  const toBytes3 = CURVE.toBytes || ((_c, point, _isCompressed) => {
    const a = point.toAffine();
    return concatBytes2(Uint8Array.from([4]), Fp.toBytes(a.x), Fp.toBytes(a.y));
  });
  const fromBytes = CURVE.fromBytes || ((bytes) => {
    const tail = bytes.subarray(1);
    const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
    const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
    return { x, y };
  });
  function weierstrassEquation(x) {
    const { a, b } = CURVE;
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function isWithinCurveOrder(num) {
    return inRange(num, _1n4, CURVE.n);
  }
  function normPrivateKeyToScalar(key) {
    const { allowedPrivateKeyLengths: lengths, nByteLength, wrapPrivateKey, n: N } = CURVE;
    if (lengths && typeof key !== "bigint") {
      if (isBytes2(key))
        key = bytesToHex(key);
      if (typeof key !== "string" || !lengths.includes(key.length))
        throw new Error("invalid private key");
      key = key.padStart(nByteLength * 2, "0");
    }
    let num;
    try {
      num = typeof key === "bigint" ? key : bytesToNumberBE(ensureBytes("private key", key, nByteLength));
    } catch (error) {
      throw new Error("invalid private key, expected hex or " + nByteLength + " bytes, got " + typeof key);
    }
    if (wrapPrivateKey)
      num = mod(num, N);
    aInRange("private key", num, _1n4, N);
    return num;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ProjectivePoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { px: x, py: y, pz: z } = p;
    if (Fp.eql(z, Fp.ONE))
      return { x, y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(z);
    const ax = Fp.mul(x, iz);
    const ay = Fp.mul(y, iz);
    const zz = Fp.mul(z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x: ax, y: ay };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (CURVE.allowInfinityPoint && !Fp.is0(p.py))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not FE");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  class Point {
    constructor(px, py, pz) {
      if (px == null || !Fp.isValid(px))
        throw new Error("x required");
      if (py == null || !Fp.isValid(py) || Fp.is0(py))
        throw new Error("y required");
      if (pz == null || !Fp.isValid(pz))
        throw new Error("z required");
      this.px = px;
      this.py = py;
      this.pz = pz;
      Object.freeze(this);
    }
    // Does not validate if the point is on-curve.
    // Use fromHex instead, or call assertValidity() later.
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      const is0 = (i) => Fp.eql(i, Fp.ZERO);
      if (is0(x) && is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * Takes a bunch of Projective Points but executes only one
     * inversion on all of them. Inversion is very slow operation,
     * so this improves performance massively.
     * Optimization: converts a list of projective points to a list of identical points with Z=1.
     */
    static normalizeZ(points) {
      const toInv = FpInvertBatch(Fp, points.map((p) => p.pz));
      return points.map((p, i) => p.toAffine(toInv[i])).map(Point.fromAffine);
    }
    /**
     * Converts hash string or Uint8Array to Point.
     * @param hex short/long ECDSA hex
     */
    static fromHex(hex) {
      const P = Point.fromAffine(fromBytes(ensureBytes("pointHex", hex)));
      P.assertValidity();
      return P;
    }
    // Multiplies generator point by privateKey.
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(normPrivateKeyToScalar(privateKey));
    }
    // Multiscalar Multiplication
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    // "Private method", don't use it directly
    _setWindowSize(windowSize) {
      wnaf.setWindowSize(this, windowSize);
    }
    // A point on curve is valid if it conforms to equation.
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (Fp.isOdd)
        return !Fp.isOdd(y);
      throw new Error("Field doesn't support isOdd");
    }
    /**
     * Compare one point to another.
     */
    equals(other) {
      aprjpoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /**
     * Flips point to one corresponding to (x, -y) in Affine coordinates.
     */
    negate() {
      return new Point(this.px, Fp.neg(this.py), this.pz);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE;
      const b3 = Fp.mul(b, _3n2);
      const { px: X1, py: Y1, pz: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      const a = CURVE.a;
      const b3 = Fp.mul(CURVE.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    wNAF(n) {
      return wnaf.wNAFCached(this, n, Point.normalizeZ);
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed private key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo: endo2, n: N } = CURVE;
      aInRange("scalar", sc, _0n4, N);
      const I = Point.ZERO;
      if (sc === _0n4)
        return I;
      if (this.is0() || sc === _1n4)
        return this;
      if (!endo2 || wnaf.hasPrecomputes(this))
        return wnaf.wNAFCachedUnsafe(this, sc, Point.normalizeZ);
      let { k1neg, k1, k2neg, k2 } = endo2.splitScalar(sc);
      let k1p = I;
      let k2p = I;
      let d = this;
      while (k1 > _0n4 || k2 > _0n4) {
        if (k1 & _1n4)
          k1p = k1p.add(d);
        if (k2 & _1n4)
          k2p = k2p.add(d);
        d = d.double();
        k1 >>= _1n4;
        k2 >>= _1n4;
      }
      if (k1neg)
        k1p = k1p.negate();
      if (k2neg)
        k2p = k2p.negate();
      k2p = new Point(Fp.mul(k2p.px, endo2.beta), k2p.py, k2p.pz);
      return k1p.add(k2p);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2, n: N } = CURVE;
      aInRange("scalar", scalar, _1n4, N);
      let point, fake;
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = endo2.splitScalar(scalar);
        let { p: k1p, f: f1p } = this.wNAF(k1);
        let { p: k2p, f: f2p } = this.wNAF(k2);
        k1p = wnaf.constTimeNegate(k1neg, k1p);
        k2p = wnaf.constTimeNegate(k2neg, k2p);
        k2p = new Point(Fp.mul(k2p.px, endo2.beta), k2p.py, k2p.pz);
        point = k1p.add(k2p);
        fake = f1p.add(f2p);
      } else {
        const { p, f } = this.wNAF(scalar);
        point = p;
        fake = f;
      }
      return Point.normalizeZ([point, fake])[0];
    }
    /**
     * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
     * Not using Strauss-Shamir trick: precomputation tables are faster.
     * The trick could be useful if both P and Q are not G (not in our case).
     * @returns non-zero affine point
     */
    multiplyAndAddUnsafe(Q, a, b) {
      const G = Point.BASE;
      const mul = (P, a2) => a2 === _0n4 || a2 === _1n4 || !P.equals(G) ? P.multiplyUnsafe(a2) : P.multiply(a2);
      const sum = mul(this, a).add(mul(Q, b));
      return sum.is0() ? void 0 : sum;
    }
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (x, y, z) ∋ (x=x/z, y=y/z)
    toAffine(iz) {
      return toAffineMemo(this, iz);
    }
    isTorsionFree() {
      const { h: cofactor, isTorsionFree } = CURVE;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      throw new Error("isTorsionFree() has not been declared for the elliptic curve");
    }
    clearCofactor() {
      const { h: cofactor, clearCofactor } = CURVE;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(CURVE.h);
    }
    toRawBytes(isCompressed = true) {
      abool("isCompressed", isCompressed);
      this.assertValidity();
      return toBytes3(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      abool("isCompressed", isCompressed);
      return bytesToHex(this.toRawBytes(isCompressed));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
  Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
  const { endo, nBitLength } = CURVE;
  const wnaf = wNAF(Point, endo ? Math.ceil(nBitLength / 2) : nBitLength);
  return {
    CURVE,
    ProjectivePoint: Point,
    normPrivateKeyToScalar,
    weierstrassEquation,
    isWithinCurveOrder
  };
}
function validateOpts(curve) {
  const opts = validateBasic(curve);
  validateObject(opts, {
    hash: "hash",
    hmac: "function",
    randomBytes: "function"
  }, {
    bits2int: "function",
    bits2int_modN: "function",
    lowS: "boolean"
  });
  return Object.freeze({ lowS: true, ...opts });
}
function weierstrass(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { Fp, n: CURVE_ORDER, nByteLength, nBitLength } = CURVE;
  const compressedLen = Fp.BYTES + 1;
  const uncompressedLen = 2 * Fp.BYTES + 1;
  function modN(a) {
    return mod(a, CURVE_ORDER);
  }
  function invN(a) {
    return invert(a, CURVE_ORDER);
  }
  const { ProjectivePoint: Point, normPrivateKeyToScalar, weierstrassEquation, isWithinCurveOrder } = weierstrassPoints({
    ...CURVE,
    toBytes(_c, point, isCompressed) {
      const a = point.toAffine();
      const x = Fp.toBytes(a.x);
      const cat = concatBytes2;
      abool("isCompressed", isCompressed);
      if (isCompressed) {
        return cat(Uint8Array.from([point.hasEvenY() ? 2 : 3]), x);
      } else {
        return cat(Uint8Array.from([4]), x, Fp.toBytes(a.y));
      }
    },
    fromBytes(bytes) {
      const len = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (len === compressedLen && (head === 2 || head === 3)) {
        const x = bytesToNumberBE(tail);
        if (!inRange(x, _1n4, Fp.ORDER))
          throw new Error("Point is not on curve");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const suffix = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("Point is not on curve" + suffix);
        }
        const isYOdd = (y & _1n4) === _1n4;
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp.neg(y);
        return { x, y };
      } else if (len === uncompressedLen && head === 4) {
        const x = Fp.fromBytes(tail.subarray(0, Fp.BYTES));
        const y = Fp.fromBytes(tail.subarray(Fp.BYTES, 2 * Fp.BYTES));
        return { x, y };
      } else {
        const cl = compressedLen;
        const ul = uncompressedLen;
        throw new Error("invalid Point, expected length of " + cl + ", or uncompressed " + ul + ", got " + len);
      }
    }
  });
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n4;
    return number > HALF;
  }
  function normalizeS(s) {
    return isBiggerThanHalfOrder(s) ? modN(-s) : s;
  }
  const slcNum = (b, from, to) => bytesToNumberBE(b.slice(from, to));
  class Signature {
    constructor(r, s, recovery) {
      aInRange("r", r, _1n4, CURVE_ORDER);
      aInRange("s", s, _1n4, CURVE_ORDER);
      this.r = r;
      this.s = s;
      if (recovery != null)
        this.recovery = recovery;
      Object.freeze(this);
    }
    // pair (bytes of r, bytes of s)
    static fromCompact(hex) {
      const l = nByteLength;
      hex = ensureBytes("compactSignature", hex, l * 2);
      return new Signature(slcNum(hex, 0, l), slcNum(hex, l, 2 * l));
    }
    // DER encoded ECDSA signature
    // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
    static fromDER(hex) {
      const { r, s } = DER.toSig(ensureBytes("DER", hex));
      return new Signature(r, s);
    }
    /**
     * @todo remove
     * @deprecated
     */
    assertValidity() {
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    recoverPublicKey(msgHash) {
      const { r, s, recovery: rec } = this;
      const h = bits2int_modN(ensureBytes("msgHash", msgHash));
      if (rec == null || ![0, 1, 2, 3].includes(rec))
        throw new Error("recovery id invalid");
      const radj = rec === 2 || rec === 3 ? r + CURVE.n : r;
      if (radj >= Fp.ORDER)
        throw new Error("recovery id 2 or 3 invalid");
      const prefix = (rec & 1) === 0 ? "02" : "03";
      const R = Point.fromHex(prefix + numToSizedHex(radj, Fp.BYTES));
      const ir = invN(radj);
      const u1 = modN(-h * ir);
      const u2 = modN(s * ir);
      const Q = Point.BASE.multiplyAndAddUnsafe(R, u1, u2);
      if (!Q)
        throw new Error("point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    normalizeS() {
      return this.hasHighS() ? new Signature(this.r, modN(-this.s), this.recovery) : this;
    }
    // DER-encoded
    toDERRawBytes() {
      return hexToBytes(this.toDERHex());
    }
    toDERHex() {
      return DER.hexFromSig(this);
    }
    // padded bytes of r, then padded bytes of s
    toCompactRawBytes() {
      return hexToBytes(this.toCompactHex());
    }
    toCompactHex() {
      const l = nByteLength;
      return numToSizedHex(this.r, l) + numToSizedHex(this.s, l);
    }
  }
  const utils = {
    isValidPrivateKey(privateKey) {
      try {
        normPrivateKeyToScalar(privateKey);
        return true;
      } catch (error) {
        return false;
      }
    },
    normPrivateKeyToScalar,
    /**
     * Produces cryptographically secure private key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    randomPrivateKey: () => {
      const length = getMinHashLength(CURVE.n);
      return mapHashToField(CURVE.randomBytes(length), CURVE.n);
    },
    /**
     * Creates precompute table for an arbitrary EC point. Makes point "cached".
     * Allows to massively speed-up `point.multiply(scalar)`.
     * @returns cached point
     * @example
     * const fast = utils.precompute(8, ProjectivePoint.fromHex(someonesPubKey));
     * fast.multiply(privKey); // much faster ECDH now
     */
    precompute(windowSize = 8, point = Point.BASE) {
      point._setWindowSize(windowSize);
      point.multiply(BigInt(3));
      return point;
    }
  };
  function getPublicKey(privateKey, isCompressed = true) {
    return Point.fromPrivateKey(privateKey).toRawBytes(isCompressed);
  }
  function isProbPub(item) {
    if (typeof item === "bigint")
      return false;
    if (item instanceof Point)
      return true;
    const arr = ensureBytes("key", item);
    const len = arr.length;
    const fpl = Fp.BYTES;
    const compLen = fpl + 1;
    const uncompLen = 2 * fpl + 1;
    if (CURVE.allowedPrivateKeyLengths || nByteLength === compLen) {
      return void 0;
    } else {
      return len === compLen || len === uncompLen;
    }
  }
  function getSharedSecret(privateA, publicB, isCompressed = true) {
    if (isProbPub(privateA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicB) === false)
      throw new Error("second arg must be public key");
    const b = Point.fromHex(publicB);
    return b.multiply(normPrivateKeyToScalar(privateA)).toRawBytes(isCompressed);
  }
  const bits2int = CURVE.bits2int || function(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - nBitLength;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = CURVE.bits2int_modN || function(bytes) {
    return modN(bits2int(bytes));
  };
  const ORDER_MASK = bitMask(nBitLength);
  function int2octets(num) {
    aInRange("num < 2^" + nBitLength, num, _0n4, ORDER_MASK);
    return numberToBytesBE(num, nByteLength);
  }
  function prepSig(msgHash, privateKey, opts = defaultSigOpts) {
    if (["recovered", "canonical"].some((k) => k in opts))
      throw new Error("sign() legacy options not supported");
    const { hash, randomBytes: randomBytes2 } = CURVE;
    let { lowS, prehash, extraEntropy: ent } = opts;
    if (lowS == null)
      lowS = true;
    msgHash = ensureBytes("msgHash", msgHash);
    validateSigVerOpts(opts);
    if (prehash)
      msgHash = ensureBytes("prehashed msgHash", hash(msgHash));
    const h1int = bits2int_modN(msgHash);
    const d = normPrivateKeyToScalar(privateKey);
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (ent != null && ent !== false) {
      const e = ent === true ? randomBytes2(Fp.BYTES) : ent;
      seedArgs.push(ensureBytes("extraEntropy", e));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!isWithinCurveOrder(k))
        return;
      const ik = invN(k);
      const q = Point.BASE.multiply(k).toAffine();
      const r = modN(q.x);
      if (r === _0n4)
        return;
      const s = modN(ik * modN(m + r * d));
      if (s === _0n4)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n4);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = normalizeS(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, recovery);
    }
    return { seed, k2sig };
  }
  const defaultSigOpts = { lowS: CURVE.lowS, prehash: false };
  const defaultVerOpts = { lowS: CURVE.lowS, prehash: false };
  function sign2(msgHash, privKey, opts = defaultSigOpts) {
    const { seed, k2sig } = prepSig(msgHash, privKey, opts);
    const C = CURVE;
    const drbg = createHmacDrbg(C.hash.outputLen, C.nByteLength, C.hmac);
    return drbg(seed, k2sig);
  }
  Point.BASE._setWindowSize(8);
  function verify(signature, msgHash, publicKey, opts = defaultVerOpts) {
    const sg = signature;
    msgHash = ensureBytes("msgHash", msgHash);
    publicKey = ensureBytes("publicKey", publicKey);
    const { lowS, prehash, format } = opts;
    validateSigVerOpts(opts);
    if ("strict" in opts)
      throw new Error("options.strict was renamed to lowS");
    if (format !== void 0 && format !== "compact" && format !== "der")
      throw new Error("format must be compact or der");
    const isHex2 = typeof sg === "string" || isBytes2(sg);
    const isObj = !isHex2 && !format && typeof sg === "object" && sg !== null && typeof sg.r === "bigint" && typeof sg.s === "bigint";
    if (!isHex2 && !isObj)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    let _sig = void 0;
    let P;
    try {
      if (isObj)
        _sig = new Signature(sg.r, sg.s);
      if (isHex2) {
        try {
          if (format !== "compact")
            _sig = Signature.fromDER(sg);
        } catch (derError) {
          if (!(derError instanceof DER.Err))
            throw derError;
        }
        if (!_sig && format !== "der")
          _sig = Signature.fromCompact(sg);
      }
      P = Point.fromHex(publicKey);
    } catch (error) {
      return false;
    }
    if (!_sig)
      return false;
    if (lowS && _sig.hasHighS())
      return false;
    if (prehash)
      msgHash = CURVE.hash(msgHash);
    const { r, s } = _sig;
    const h = bits2int_modN(msgHash);
    const is = invN(s);
    const u1 = modN(h * is);
    const u2 = modN(r * is);
    const R = Point.BASE.multiplyAndAddUnsafe(P, u1, u2)?.toAffine();
    if (!R)
      return false;
    const v = modN(R.x);
    return v === r;
  }
  return {
    CURVE,
    getPublicKey,
    getSharedSecret,
    sign: sign2,
    verify,
    ProjectivePoint: Point,
    Signature,
    utils
  };
}

// ../-ai-dex-manager/node_modules/@noble/curves/esm/_shortw_utils.js
function getHash(hash) {
  return {
    hash,
    hmac: (key, ...msgs) => hmac(hash, key, concatBytes(...msgs)),
    randomBytes
  };
}
function createCurve(curveDef, defHash) {
  const create = (hash) => weierstrass({ ...curveDef, ...getHash(hash) });
  return { ...create(defHash), create };
}

// ../-ai-dex-manager/node_modules/@noble/curves/esm/secp256k1.js
var secp256k1P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
var secp256k1N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
var divNearest = (a, b) => (a + b / _2n3) / b;
function sqrtMod(y) {
  const P = secp256k1P;
  const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n3, P) * b3 % P;
  const b9 = pow2(b6, _3n3, P) * b3 % P;
  const b11 = pow2(b9, _2n3, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n3, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n3, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = Field(secp256k1P, void 0, void 0, { sqrt: sqrtMod });
var secp256k1 = createCurve({
  a: _0n5,
  b: BigInt(7),
  Fp: Fpk1,
  n: secp256k1N,
  Gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  Gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424"),
  h: BigInt(1),
  lowS: true,
  // Allow only low-S signatures by default in sign() and verify()
  endo: {
    // Endomorphism, see above
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    splitScalar: (k) => {
      const n = secp256k1N;
      const a1 = BigInt("0x3086d221a7d46bcde86c90e49284eb15");
      const b1 = -_1n5 * BigInt("0xe4437ed6010e88286f547fa90abfe4c3");
      const a2 = BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8");
      const b2 = a1;
      const POW_2_128 = BigInt("0x100000000000000000000000000000000");
      const c1 = divNearest(b2 * k, n);
      const c2 = divNearest(-b1 * k, n);
      let k1 = mod(k - c1 * a1 - c2 * a2, n);
      let k2 = mod(-c1 * b1 - c2 * b2, n);
      const k1neg = k1 > POW_2_128;
      const k2neg = k2 > POW_2_128;
      if (k1neg)
        k1 = n - k1;
      if (k2neg)
        k2 = n - k2;
      if (k1 > POW_2_128 || k2 > POW_2_128) {
        throw new Error("splitScalar: Endomorphism failed, k=" + k);
      }
      return { k1neg, k1, k2neg, k2 };
    }
  }
}, sha256);

// ../-ai-dex-manager/node_modules/viem/_esm/errors/version.js
var version = "2.48.4";

// ../-ai-dex-manager/node_modules/viem/_esm/errors/base.js
var errorConfig = {
  getDocsUrl: ({ docsBaseUrl, docsPath = "", docsSlug }) => docsPath ? `${docsBaseUrl ?? "https://viem.sh"}${docsPath}${docsSlug ? `#${docsSlug}` : ""}` : void 0,
  version: `viem@${version}`
};
var BaseError = class _BaseError extends Error {
  constructor(shortMessage, args = {}) {
    const details = (() => {
      if (args.cause instanceof _BaseError)
        return args.cause.details;
      if (args.cause?.message)
        return args.cause.message;
      return args.details;
    })();
    const docsPath = (() => {
      if (args.cause instanceof _BaseError)
        return args.cause.docsPath || args.docsPath;
      return args.docsPath;
    })();
    const docsUrl = errorConfig.getDocsUrl?.({ ...args, docsPath });
    const message = [
      shortMessage || "An error occurred.",
      "",
      ...args.metaMessages ? [...args.metaMessages, ""] : [],
      ...docsUrl ? [`Docs: ${docsUrl}`] : [],
      ...details ? [`Details: ${details}`] : [],
      ...errorConfig.version ? [`Version: ${errorConfig.version}`] : []
    ].join("\n");
    super(message, args.cause ? { cause: args.cause } : void 0);
    Object.defineProperty(this, "details", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "docsPath", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "metaMessages", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "shortMessage", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "version", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "BaseError"
    });
    this.details = details;
    this.docsPath = docsPath;
    this.metaMessages = args.metaMessages;
    this.name = args.name ?? this.name;
    this.shortMessage = shortMessage;
    this.version = version;
  }
  walk(fn) {
    return walk(this, fn);
  }
};
function walk(err, fn) {
  if (fn?.(err))
    return err;
  if (err && typeof err === "object" && "cause" in err && err.cause !== void 0)
    return walk(err.cause, fn);
  return fn ? null : err;
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/encoding.js
var IntegerOutOfRangeError = class extends BaseError {
  constructor({ max, min, signed, size: size2, value }) {
    super(`Number "${value}" is not in safe ${size2 ? `${size2 * 8}-bit ${signed ? "signed" : "unsigned"} ` : ""}integer range ${max ? `(${min} to ${max})` : `(above ${min})`}`, { name: "IntegerOutOfRangeError" });
  }
};
var SizeOverflowError = class extends BaseError {
  constructor({ givenSize, maxSize }) {
    super(`Size cannot exceed ${maxSize} bytes. Given size: ${givenSize} bytes.`, { name: "SizeOverflowError" });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/isHex.js
function isHex(value, { strict = true } = {}) {
  if (!value)
    return false;
  if (typeof value !== "string")
    return false;
  return strict ? /^0x[0-9a-fA-F]*$/.test(value) : value.startsWith("0x");
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/size.js
function size(value) {
  if (isHex(value, { strict: false }))
    return Math.ceil((value.length - 2) / 2);
  return value.length;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/trim.js
function trim(hexOrBytes, { dir = "left" } = {}) {
  let data = typeof hexOrBytes === "string" ? hexOrBytes.replace("0x", "") : hexOrBytes;
  let sliceLength = 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[dir === "left" ? i : data.length - i - 1].toString() === "0")
      sliceLength++;
    else
      break;
  }
  data = dir === "left" ? data.slice(sliceLength) : data.slice(0, data.length - sliceLength);
  if (typeof hexOrBytes === "string") {
    if (data.length === 1 && dir === "right")
      data = `${data}0`;
    return `0x${data.length % 2 === 1 ? `0${data}` : data}`;
  }
  return data;
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/data.js
var SliceOffsetOutOfBoundsError = class extends BaseError {
  constructor({ offset, position, size: size2 }) {
    super(`Slice ${position === "start" ? "starting" : "ending"} at offset "${offset}" is out-of-bounds (size: ${size2}).`, { name: "SliceOffsetOutOfBoundsError" });
  }
};
var SizeExceedsPaddingSizeError = class extends BaseError {
  constructor({ size: size2, targetSize, type }) {
    super(`${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()} size (${size2}) exceeds padding size (${targetSize}).`, { name: "SizeExceedsPaddingSizeError" });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/pad.js
function pad(hexOrBytes, { dir, size: size2 = 32 } = {}) {
  if (typeof hexOrBytes === "string")
    return padHex(hexOrBytes, { dir, size: size2 });
  return padBytes(hexOrBytes, { dir, size: size2 });
}
function padHex(hex_, { dir, size: size2 = 32 } = {}) {
  if (size2 === null)
    return hex_;
  const hex = hex_.replace("0x", "");
  if (hex.length > size2 * 2)
    throw new SizeExceedsPaddingSizeError({
      size: Math.ceil(hex.length / 2),
      targetSize: size2,
      type: "hex"
    });
  return `0x${hex[dir === "right" ? "padEnd" : "padStart"](size2 * 2, "0")}`;
}
function padBytes(bytes, { dir, size: size2 = 32 } = {}) {
  if (size2 === null)
    return bytes;
  if (bytes.length > size2)
    throw new SizeExceedsPaddingSizeError({
      size: bytes.length,
      targetSize: size2,
      type: "bytes"
    });
  const paddedBytes = new Uint8Array(size2);
  for (let i = 0; i < size2; i++) {
    const padEnd = dir === "right";
    paddedBytes[padEnd ? i : size2 - i - 1] = bytes[padEnd ? i : bytes.length - i - 1];
  }
  return paddedBytes;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/encoding/toHex.js
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_v, i) => i.toString(16).padStart(2, "0"));
function toHex(value, opts = {}) {
  if (typeof value === "number" || typeof value === "bigint")
    return numberToHex(value, opts);
  if (typeof value === "string") {
    return stringToHex(value, opts);
  }
  if (typeof value === "boolean")
    return boolToHex(value, opts);
  return bytesToHex2(value, opts);
}
function boolToHex(value, opts = {}) {
  const hex = `0x${Number(value)}`;
  if (typeof opts.size === "number") {
    assertSize(hex, { size: opts.size });
    return pad(hex, { size: opts.size });
  }
  return hex;
}
function bytesToHex2(value, opts = {}) {
  let string = "";
  for (let i = 0; i < value.length; i++) {
    string += hexes2[value[i]];
  }
  const hex = `0x${string}`;
  if (typeof opts.size === "number") {
    assertSize(hex, { size: opts.size });
    return pad(hex, { dir: "right", size: opts.size });
  }
  return hex;
}
function numberToHex(value_, opts = {}) {
  const { signed, size: size2 } = opts;
  const value = BigInt(value_);
  let maxValue;
  if (size2) {
    if (signed)
      maxValue = (1n << BigInt(size2) * 8n - 1n) - 1n;
    else
      maxValue = 2n ** (BigInt(size2) * 8n) - 1n;
  } else if (typeof value_ === "number") {
    maxValue = BigInt(Number.MAX_SAFE_INTEGER);
  }
  const minValue = typeof maxValue === "bigint" && signed ? -maxValue - 1n : 0;
  if (maxValue && value > maxValue || value < minValue) {
    const suffix = typeof value_ === "bigint" ? "n" : "";
    throw new IntegerOutOfRangeError({
      max: maxValue ? `${maxValue}${suffix}` : void 0,
      min: `${minValue}${suffix}`,
      signed,
      size: size2,
      value: `${value_}${suffix}`
    });
  }
  const hex = `0x${(signed && value < 0 ? (1n << BigInt(size2 * 8)) + BigInt(value) : value).toString(16)}`;
  if (size2)
    return pad(hex, { size: size2 });
  return hex;
}
var encoder = /* @__PURE__ */ new TextEncoder();
function stringToHex(value_, opts = {}) {
  const value = encoder.encode(value_);
  return bytesToHex2(value, opts);
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/encoding/toBytes.js
var encoder2 = /* @__PURE__ */ new TextEncoder();
function toBytes2(value, opts = {}) {
  if (typeof value === "number" || typeof value === "bigint")
    return numberToBytes(value, opts);
  if (typeof value === "boolean")
    return boolToBytes(value, opts);
  if (isHex(value))
    return hexToBytes2(value, opts);
  return stringToBytes(value, opts);
}
function boolToBytes(value, opts = {}) {
  const bytes = new Uint8Array(1);
  bytes[0] = Number(value);
  if (typeof opts.size === "number") {
    assertSize(bytes, { size: opts.size });
    return pad(bytes, { size: opts.size });
  }
  return bytes;
}
var charCodeMap = {
  zero: 48,
  nine: 57,
  A: 65,
  F: 70,
  a: 97,
  f: 102
};
function charCodeToBase16(char) {
  if (char >= charCodeMap.zero && char <= charCodeMap.nine)
    return char - charCodeMap.zero;
  if (char >= charCodeMap.A && char <= charCodeMap.F)
    return char - (charCodeMap.A - 10);
  if (char >= charCodeMap.a && char <= charCodeMap.f)
    return char - (charCodeMap.a - 10);
  return void 0;
}
function hexToBytes2(hex_, opts = {}) {
  let hex = hex_;
  if (opts.size) {
    assertSize(hex, { size: opts.size });
    hex = pad(hex, { dir: "right", size: opts.size });
  }
  let hexString = hex.slice(2);
  if (hexString.length % 2)
    hexString = `0${hexString}`;
  const length = hexString.length / 2;
  const bytes = new Uint8Array(length);
  for (let index = 0, j = 0; index < length; index++) {
    const nibbleLeft = charCodeToBase16(hexString.charCodeAt(j++));
    const nibbleRight = charCodeToBase16(hexString.charCodeAt(j++));
    if (nibbleLeft === void 0 || nibbleRight === void 0) {
      throw new BaseError(`Invalid byte sequence ("${hexString[j - 2]}${hexString[j - 1]}" in "${hexString}").`);
    }
    bytes[index] = nibbleLeft * 16 + nibbleRight;
  }
  return bytes;
}
function numberToBytes(value, opts) {
  const hex = numberToHex(value, opts);
  return hexToBytes2(hex);
}
function stringToBytes(value, opts = {}) {
  const bytes = encoder2.encode(value);
  if (typeof opts.size === "number") {
    assertSize(bytes, { size: opts.size });
    return pad(bytes, { dir: "right", size: opts.size });
  }
  return bytes;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/encoding/fromHex.js
function assertSize(hexOrBytes, { size: size2 }) {
  if (size(hexOrBytes) > size2)
    throw new SizeOverflowError({
      givenSize: size(hexOrBytes),
      maxSize: size2
    });
}
function hexToBigInt(hex, opts = {}) {
  const { signed } = opts;
  if (opts.size)
    assertSize(hex, { size: opts.size });
  const value = BigInt(hex);
  if (!signed)
    return value;
  const size2 = (hex.length - 2) / 2;
  const max = (1n << BigInt(size2) * 8n - 1n) - 1n;
  if (value <= max)
    return value;
  return value - BigInt(`0x${"f".padStart(size2 * 2, "f")}`) - 1n;
}
function hexToNumber2(hex, opts = {}) {
  const value = hexToBigInt(hex, opts);
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new IntegerOutOfRangeError({
      max: `${Number.MAX_SAFE_INTEGER}`,
      min: `${Number.MIN_SAFE_INTEGER}`,
      signed: opts.signed,
      size: opts.size,
      value: `${value}n`
    });
  return number;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/lru.js
var LruMap = class extends Map {
  constructor(size2) {
    super();
    Object.defineProperty(this, "maxSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.maxSize = size2;
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key)) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }
  set(key, value) {
    if (super.has(key))
      super.delete(key);
    super.set(key, value);
    if (this.maxSize && this.size > this.maxSize) {
      const firstKey = super.keys().next().value;
      if (firstKey !== void 0)
        super.delete(firstKey);
    }
    return this;
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/signature/serializeSignature.js
function serializeSignature({ r, s, to = "hex", v, yParity }) {
  const yParity_ = (() => {
    if (yParity === 0 || yParity === 1)
      return yParity;
    if (v && (v === 27n || v === 28n || v >= 35n))
      return v % 2n === 0n ? 1 : 0;
    throw new Error("Invalid `v` or `yParity` value");
  })();
  const signature = `0x${new secp256k1.Signature(hexToBigInt(r), hexToBigInt(s)).toCompactHex()}${yParity_ === 0 ? "1b" : "1c"}`;
  if (to === "hex")
    return signature;
  return hexToBytes2(signature);
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/address.js
var InvalidAddressError = class extends BaseError {
  constructor({ address }) {
    super(`Address "${address}" is invalid.`, {
      metaMessages: [
        "- Address must be a hex value of 20 bytes (40 hex characters).",
        "- Address must match its checksum counterpart."
      ],
      name: "InvalidAddressError"
    });
  }
};

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/sha3.js
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _7n = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round2 = 0, R = _1n6, x = 1, y = 0; round2 < 24; round2++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round2 + 1) * (round2 + 2) / 2 % 64);
  let t = _0n6;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n6 ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n4)
      t ^= _1n6 << (_1n6 << /* @__PURE__ */ BigInt(j)) - _1n6;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round2 = 24 - rounds; round2 < 24; round2++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round2];
    s[1] ^= SHA3_IOTA_L[round2];
  }
  clean(B);
}
var Keccak = class _Keccak extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    this.enableXOF = false;
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    anumber(outputLen);
    if (!(0 < blockLen && blockLen < 200))
      throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { blockLen, state } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => createHasher(() => new Keccak(blockLen, suffix, outputLen));
var keccak_256 = /* @__PURE__ */ (() => gen(1, 136, 256 / 8))();

// ../-ai-dex-manager/node_modules/viem/_esm/utils/hash/keccak256.js
function keccak256(value, to_) {
  const to = to_ || "hex";
  const bytes = keccak_256(isHex(value, { strict: false }) ? toBytes2(value) : value);
  if (to === "bytes")
    return bytes;
  return toHex(bytes);
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/address/getAddress.js
var checksumAddressCache = /* @__PURE__ */ new LruMap(8192);
function checksumAddress(address_, chainId) {
  if (checksumAddressCache.has(`${address_}.${chainId}`))
    return checksumAddressCache.get(`${address_}.${chainId}`);
  const hexAddress = chainId ? `${chainId}${address_.toLowerCase()}` : address_.substring(2).toLowerCase();
  const hash = keccak256(stringToBytes(hexAddress), "bytes");
  const address = (chainId ? hexAddress.substring(`${chainId}0x`.length) : hexAddress).split("");
  for (let i = 0; i < 40; i += 2) {
    if (hash[i >> 1] >> 4 >= 8 && address[i]) {
      address[i] = address[i].toUpperCase();
    }
    if ((hash[i >> 1] & 15) >= 8 && address[i + 1]) {
      address[i + 1] = address[i + 1].toUpperCase();
    }
  }
  const result = `0x${address.join("")}`;
  checksumAddressCache.set(`${address_}.${chainId}`, result);
  return result;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/address/isAddress.js
var addressRegex = /^0x[a-fA-F0-9]{40}$/;
var isAddressCache = /* @__PURE__ */ new LruMap(8192);
function isAddress(address, options) {
  const { strict = true } = options ?? {};
  const cacheKey = `${address}.${strict}`;
  if (isAddressCache.has(cacheKey))
    return isAddressCache.get(cacheKey);
  const result = (() => {
    if (!addressRegex.test(address))
      return false;
    if (address.toLowerCase() === address)
      return true;
    if (strict)
      return checksumAddress(address) === address;
    return true;
  })();
  isAddressCache.set(cacheKey, result);
  return result;
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/toAccount.js
function toAccount(source) {
  if (typeof source === "string") {
    if (!isAddress(source, { strict: false }))
      throw new InvalidAddressError({ address: source });
    return {
      address: source,
      type: "json-rpc"
    };
  }
  if (!isAddress(source.address, { strict: false }))
    throw new InvalidAddressError({ address: source.address });
  return {
    address: source.address,
    nonceManager: source.nonceManager,
    sign: source.sign,
    signAuthorization: source.signAuthorization,
    signMessage: source.signMessage,
    signTransaction: source.signTransaction,
    signTypedData: source.signTypedData,
    source: "custom",
    type: "local"
  };
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/publicKeyToAddress.js
function publicKeyToAddress(publicKey) {
  const address = keccak256(`0x${publicKey.substring(4)}`).substring(26);
  return checksumAddress(`0x${address}`);
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/sign.js
var extraEntropy = false;
async function sign({ hash, privateKey, to = "object" }) {
  const { r, s, recovery } = secp256k1.sign(hash.slice(2), privateKey.slice(2), {
    lowS: true,
    extraEntropy: isHex(extraEntropy, { strict: false }) ? hexToBytes2(extraEntropy) : extraEntropy
  });
  const signature = {
    r: numberToHex(r, { size: 32 }),
    s: numberToHex(s, { size: 32 }),
    v: recovery ? 28n : 27n,
    yParity: recovery
  };
  return (() => {
    if (to === "bytes" || to === "hex")
      return serializeSignature({ ...signature, to });
    return signature;
  })();
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/concat.js
function concat(values) {
  if (typeof values[0] === "string")
    return concatHex(values);
  return concatBytes3(values);
}
function concatBytes3(values) {
  let length = 0;
  for (const arr of values) {
    length += arr.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const arr of values) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
function concatHex(values) {
  return `0x${values.reduce((acc, x) => acc + x.replace("0x", ""), "")}`;
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/cursor.js
var NegativeOffsetError = class extends BaseError {
  constructor({ offset }) {
    super(`Offset \`${offset}\` cannot be negative.`, {
      name: "NegativeOffsetError"
    });
  }
};
var PositionOutOfBoundsError = class extends BaseError {
  constructor({ length, position }) {
    super(`Position \`${position}\` is out of bounds (\`0 < position < ${length}\`).`, { name: "PositionOutOfBoundsError" });
  }
};
var RecursiveReadLimitExceededError = class extends BaseError {
  constructor({ count, limit }) {
    super(`Recursive read limit of \`${limit}\` exceeded (recursive read count: \`${count}\`).`, { name: "RecursiveReadLimitExceededError" });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/cursor.js
var staticCursor = {
  bytes: new Uint8Array(),
  dataView: new DataView(new ArrayBuffer(0)),
  position: 0,
  positionReadCount: /* @__PURE__ */ new Map(),
  recursiveReadCount: 0,
  recursiveReadLimit: Number.POSITIVE_INFINITY,
  assertReadLimit() {
    if (this.recursiveReadCount >= this.recursiveReadLimit)
      throw new RecursiveReadLimitExceededError({
        count: this.recursiveReadCount + 1,
        limit: this.recursiveReadLimit
      });
  },
  assertPosition(position) {
    if (position < 0 || position > this.bytes.length - 1)
      throw new PositionOutOfBoundsError({
        length: this.bytes.length,
        position
      });
  },
  decrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position - offset;
    this.assertPosition(position);
    this.position = position;
  },
  getReadCount(position) {
    return this.positionReadCount.get(position || this.position) || 0;
  },
  incrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position + offset;
    this.assertPosition(position);
    this.position = position;
  },
  inspectByte(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectBytes(length, position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + length - 1);
    return this.bytes.subarray(position, position + length);
  },
  inspectUint8(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectUint16(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 1);
    return this.dataView.getUint16(position);
  },
  inspectUint24(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 2);
    return (this.dataView.getUint16(position) << 8) + this.dataView.getUint8(position + 2);
  },
  inspectUint32(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 3);
    return this.dataView.getUint32(position);
  },
  pushByte(byte) {
    this.assertPosition(this.position);
    this.bytes[this.position] = byte;
    this.position++;
  },
  pushBytes(bytes) {
    this.assertPosition(this.position + bytes.length - 1);
    this.bytes.set(bytes, this.position);
    this.position += bytes.length;
  },
  pushUint8(value) {
    this.assertPosition(this.position);
    this.bytes[this.position] = value;
    this.position++;
  },
  pushUint16(value) {
    this.assertPosition(this.position + 1);
    this.dataView.setUint16(this.position, value);
    this.position += 2;
  },
  pushUint24(value) {
    this.assertPosition(this.position + 2);
    this.dataView.setUint16(this.position, value >> 8);
    this.dataView.setUint8(this.position + 2, value & ~4294967040);
    this.position += 3;
  },
  pushUint32(value) {
    this.assertPosition(this.position + 3);
    this.dataView.setUint32(this.position, value);
    this.position += 4;
  },
  readByte() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectByte();
    this.position++;
    return value;
  },
  readBytes(length, size2) {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectBytes(length);
    this.position += size2 ?? length;
    return value;
  },
  readUint8() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint8();
    this.position += 1;
    return value;
  },
  readUint16() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint16();
    this.position += 2;
    return value;
  },
  readUint24() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint24();
    this.position += 3;
    return value;
  },
  readUint32() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint32();
    this.position += 4;
    return value;
  },
  get remaining() {
    return this.bytes.length - this.position;
  },
  setPosition(position) {
    const oldPosition = this.position;
    this.assertPosition(position);
    this.position = position;
    return () => this.position = oldPosition;
  },
  _touch() {
    if (this.recursiveReadLimit === Number.POSITIVE_INFINITY)
      return;
    const count = this.getReadCount();
    this.positionReadCount.set(this.position, count + 1);
    if (count > 0)
      this.recursiveReadCount++;
  }
};
function createCursor(bytes, { recursiveReadLimit = 8192 } = {}) {
  const cursor = Object.create(staticCursor);
  cursor.bytes = bytes;
  cursor.dataView = new DataView(bytes.buffer ?? bytes, bytes.byteOffset, bytes.byteLength);
  cursor.positionReadCount = /* @__PURE__ */ new Map();
  cursor.recursiveReadLimit = recursiveReadLimit;
  return cursor;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/encoding/toRlp.js
function toRlp(bytes, to = "hex") {
  const encodable = getEncodable(bytes);
  const cursor = createCursor(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (to === "hex")
    return bytesToHex2(cursor.bytes);
  return cursor.bytes;
}
function getEncodable(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList(bytes.map((x) => getEncodable(x)));
  return getEncodableBytes(bytes);
}
function getEncodableList(list) {
  const bodyLength = list.reduce((acc, x) => acc + x.length, 0);
  const sizeOfBodyLength = getSizeOfLength(bodyLength);
  const length = (() => {
    if (bodyLength <= 55)
      return 1 + bodyLength;
    return 1 + sizeOfBodyLength + bodyLength;
  })();
  return {
    length,
    encode(cursor) {
      if (bodyLength <= 55) {
        cursor.pushByte(192 + bodyLength);
      } else {
        cursor.pushByte(192 + 55 + sizeOfBodyLength);
        if (sizeOfBodyLength === 1)
          cursor.pushUint8(bodyLength);
        else if (sizeOfBodyLength === 2)
          cursor.pushUint16(bodyLength);
        else if (sizeOfBodyLength === 3)
          cursor.pushUint24(bodyLength);
        else
          cursor.pushUint32(bodyLength);
      }
      for (const { encode } of list) {
        encode(cursor);
      }
    }
  };
}
function getEncodableBytes(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? hexToBytes2(bytesOrHex) : bytesOrHex;
  const sizeOfBytesLength = getSizeOfLength(bytes.length);
  const length = (() => {
    if (bytes.length === 1 && bytes[0] < 128)
      return 1;
    if (bytes.length <= 55)
      return 1 + bytes.length;
    return 1 + sizeOfBytesLength + bytes.length;
  })();
  return {
    length,
    encode(cursor) {
      if (bytes.length === 1 && bytes[0] < 128) {
        cursor.pushBytes(bytes);
      } else if (bytes.length <= 55) {
        cursor.pushByte(128 + bytes.length);
        cursor.pushBytes(bytes);
      } else {
        cursor.pushByte(128 + 55 + sizeOfBytesLength);
        if (sizeOfBytesLength === 1)
          cursor.pushUint8(bytes.length);
        else if (sizeOfBytesLength === 2)
          cursor.pushUint16(bytes.length);
        else if (sizeOfBytesLength === 3)
          cursor.pushUint24(bytes.length);
        else
          cursor.pushUint32(bytes.length);
        cursor.pushBytes(bytes);
      }
    }
  };
}
function getSizeOfLength(length) {
  if (length < 2 ** 8)
    return 1;
  if (length < 2 ** 16)
    return 2;
  if (length < 2 ** 24)
    return 3;
  if (length < 2 ** 32)
    return 4;
  throw new BaseError("Length is too large.");
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/authorization/hashAuthorization.js
function hashAuthorization(parameters) {
  const { chainId, nonce, to } = parameters;
  const address = parameters.contractAddress ?? parameters.address;
  const hash = keccak256(concatHex([
    "0x05",
    toRlp([
      chainId ? numberToHex(chainId) : "0x",
      address,
      nonce ? numberToHex(nonce) : "0x"
    ])
  ]));
  if (to === "bytes")
    return hexToBytes2(hash);
  return hash;
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/signAuthorization.js
async function signAuthorization(parameters) {
  const { chainId, nonce, privateKey, to = "object" } = parameters;
  const address = parameters.contractAddress ?? parameters.address;
  const signature = await sign({
    hash: hashAuthorization({ address, chainId, nonce }),
    privateKey,
    to
  });
  if (to === "object")
    return {
      address,
      chainId,
      nonce,
      ...signature
    };
  return signature;
}

// ../-ai-dex-manager/node_modules/viem/_esm/constants/strings.js
var presignMessagePrefix = "Ethereum Signed Message:\n";

// ../-ai-dex-manager/node_modules/viem/_esm/utils/signature/toPrefixedMessage.js
function toPrefixedMessage(message_) {
  const message = (() => {
    if (typeof message_ === "string")
      return stringToHex(message_);
    if (typeof message_.raw === "string")
      return message_.raw;
    return bytesToHex2(message_.raw);
  })();
  const prefix = stringToHex(`${presignMessagePrefix}${size(message)}`);
  return concat([prefix, message]);
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/signature/hashMessage.js
function hashMessage(message, to_) {
  return keccak256(toPrefixedMessage(message), to_);
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/signMessage.js
async function signMessage({ message, privateKey }) {
  return await sign({ hash: hashMessage(message), privateKey, to: "hex" });
}

// ../-ai-dex-manager/node_modules/viem/_esm/constants/unit.js
var gweiUnits = {
  ether: -9,
  wei: 9
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/unit/formatUnits.js
function formatUnits(value, decimals) {
  let display = value.toString();
  const negative = display.startsWith("-");
  if (negative)
    display = display.slice(1);
  display = display.padStart(decimals, "0");
  let [integer, fraction] = [
    display.slice(0, display.length - decimals),
    display.slice(display.length - decimals)
  ];
  fraction = fraction.replace(/(0+)$/, "");
  return `${negative ? "-" : ""}${integer || "0"}${fraction ? `.${fraction}` : ""}`;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/unit/formatGwei.js
function formatGwei(wei, unit = "wei") {
  return formatUnits(wei, gweiUnits[unit]);
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/transaction.js
function prettyPrint(args) {
  const entries = Object.entries(args).map(([key, value]) => {
    if (value === void 0 || value === false)
      return null;
    return [key, value];
  }).filter(Boolean);
  const maxLength = entries.reduce((acc, [key]) => Math.max(acc, key.length), 0);
  return entries.map(([key, value]) => `  ${`${key}:`.padEnd(maxLength + 1)}  ${value}`).join("\n");
}
var InvalidLegacyVError = class extends BaseError {
  constructor({ v }) {
    super(`Invalid \`v\` value "${v}". Expected 27 or 28.`, {
      name: "InvalidLegacyVError"
    });
  }
};
var InvalidSerializableTransactionError = class extends BaseError {
  constructor({ transaction }) {
    super("Cannot infer a transaction type from provided transaction.", {
      metaMessages: [
        "Provided Transaction:",
        "{",
        prettyPrint(transaction),
        "}",
        "",
        "To infer the type, either provide:",
        "- a `type` to the Transaction, or",
        "- an EIP-1559 Transaction with `maxFeePerGas`, or",
        "- an EIP-2930 Transaction with `gasPrice` & `accessList`, or",
        "- an EIP-4844 Transaction with `blobs`, `blobVersionedHashes`, `sidecars`, or",
        "- an EIP-7702 Transaction with `authorizationList`, or",
        "- a Legacy Transaction with `gasPrice`"
      ],
      name: "InvalidSerializableTransactionError"
    });
  }
};
var InvalidStorageKeySizeError = class extends BaseError {
  constructor({ storageKey }) {
    super(`Size for storage key "${storageKey}" is invalid. Expected 32 bytes. Got ${Math.floor((storageKey.length - 2) / 2)} bytes.`, { name: "InvalidStorageKeySizeError" });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/authorization/serializeAuthorizationList.js
function serializeAuthorizationList(authorizationList) {
  if (!authorizationList || authorizationList.length === 0)
    return [];
  const serializedAuthorizationList = [];
  for (const authorization of authorizationList) {
    const { chainId, nonce, ...signature } = authorization;
    const contractAddress = authorization.address;
    serializedAuthorizationList.push([
      chainId ? toHex(chainId) : "0x",
      contractAddress,
      nonce ? toHex(nonce) : "0x",
      ...toYParitySignatureArray({}, signature)
    ]);
  }
  return serializedAuthorizationList;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/blobsToCommitments.js
function blobsToCommitments(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x) => hexToBytes2(x)) : parameters.blobs;
  const commitments = [];
  for (const blob of blobs)
    commitments.push(Uint8Array.from(kzg.blobToKzgCommitment(blob)));
  return to === "bytes" ? commitments : commitments.map((x) => bytesToHex2(x));
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/blobsToProofs.js
function blobsToProofs(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x) => hexToBytes2(x)) : parameters.blobs;
  const commitments = typeof parameters.commitments[0] === "string" ? parameters.commitments.map((x) => hexToBytes2(x)) : parameters.commitments;
  const proofs = [];
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    const commitment = commitments[i];
    proofs.push(Uint8Array.from(kzg.computeBlobKzgProof(blob, commitment)));
  }
  return to === "bytes" ? proofs : proofs.map((x) => bytesToHex2(x));
}

// ../-ai-dex-manager/node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// ../-ai-dex-manager/node_modules/viem/_esm/utils/hash/sha256.js
function sha2563(value, to_) {
  const to = to_ || "hex";
  const bytes = sha2562(isHex(value, { strict: false }) ? toBytes2(value) : value);
  if (to === "bytes")
    return bytes;
  return toHex(bytes);
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/commitmentToVersionedHash.js
function commitmentToVersionedHash(parameters) {
  const { commitment, version: version2 = 1 } = parameters;
  const to = parameters.to ?? (typeof commitment === "string" ? "hex" : "bytes");
  const versionedHash = sha2563(commitment, "bytes");
  versionedHash.set([version2], 0);
  return to === "bytes" ? versionedHash : bytesToHex2(versionedHash);
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/commitmentsToVersionedHashes.js
function commitmentsToVersionedHashes(parameters) {
  const { commitments, version: version2 } = parameters;
  const to = parameters.to ?? (typeof commitments[0] === "string" ? "hex" : "bytes");
  const hashes = [];
  for (const commitment of commitments) {
    hashes.push(commitmentToVersionedHash({
      commitment,
      to,
      version: version2
    }));
  }
  return hashes;
}

// ../-ai-dex-manager/node_modules/viem/_esm/constants/blob.js
var blobsPerTransaction = 6;
var bytesPerFieldElement = 32;
var fieldElementsPerBlob = 4096;
var bytesPerBlob = bytesPerFieldElement * fieldElementsPerBlob;
var maxBytesPerTransaction = bytesPerBlob * blobsPerTransaction - // terminator byte (0x80).
1 - // zero byte (0x00) appended to each field element.
1 * fieldElementsPerBlob * blobsPerTransaction;

// ../-ai-dex-manager/node_modules/viem/_esm/constants/kzg.js
var versionedHashVersionKzg = 1;

// ../-ai-dex-manager/node_modules/viem/_esm/errors/blob.js
var BlobSizeTooLargeError = class extends BaseError {
  constructor({ maxSize, size: size2 }) {
    super("Blob size is too large.", {
      metaMessages: [`Max: ${maxSize} bytes`, `Given: ${size2} bytes`],
      name: "BlobSizeTooLargeError"
    });
  }
};
var EmptyBlobError = class extends BaseError {
  constructor() {
    super("Blob data must not be empty.", { name: "EmptyBlobError" });
  }
};
var InvalidVersionedHashSizeError = class extends BaseError {
  constructor({ hash, size: size2 }) {
    super(`Versioned hash "${hash}" size is invalid.`, {
      metaMessages: ["Expected: 32", `Received: ${size2}`],
      name: "InvalidVersionedHashSizeError"
    });
  }
};
var InvalidVersionedHashVersionError = class extends BaseError {
  constructor({ hash, version: version2 }) {
    super(`Versioned hash "${hash}" version is invalid.`, {
      metaMessages: [
        `Expected: ${versionedHashVersionKzg}`,
        `Received: ${version2}`
      ],
      name: "InvalidVersionedHashVersionError"
    });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/toBlobs.js
function toBlobs(parameters) {
  const to = parameters.to ?? (typeof parameters.data === "string" ? "hex" : "bytes");
  const data = typeof parameters.data === "string" ? hexToBytes2(parameters.data) : parameters.data;
  const size_ = size(data);
  if (!size_)
    throw new EmptyBlobError();
  if (size_ > maxBytesPerTransaction)
    throw new BlobSizeTooLargeError({
      maxSize: maxBytesPerTransaction,
      size: size_
    });
  const blobs = [];
  let active = true;
  let position = 0;
  while (active) {
    const blob = createCursor(new Uint8Array(bytesPerBlob));
    let size2 = 0;
    while (size2 < fieldElementsPerBlob) {
      const bytes = data.slice(position, position + (bytesPerFieldElement - 1));
      blob.pushByte(0);
      blob.pushBytes(bytes);
      if (bytes.length < 31) {
        blob.pushByte(128);
        active = false;
        break;
      }
      size2++;
      position += 31;
    }
    blobs.push(blob);
  }
  return to === "bytes" ? blobs.map((x) => x.bytes) : blobs.map((x) => bytesToHex2(x.bytes));
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/blob/toBlobSidecars.js
function toBlobSidecars(parameters) {
  const { data, kzg, to } = parameters;
  const blobs = parameters.blobs ?? toBlobs({ data, to });
  const commitments = parameters.commitments ?? blobsToCommitments({ blobs, kzg, to });
  const proofs = parameters.proofs ?? blobsToProofs({ blobs, commitments, kzg, to });
  const sidecars = [];
  for (let i = 0; i < blobs.length; i++)
    sidecars.push({
      blob: blobs[i],
      commitment: commitments[i],
      proof: proofs[i]
    });
  return sidecars;
}

// ../-ai-dex-manager/node_modules/viem/_esm/constants/number.js
var maxInt8 = 2n ** (8n - 1n) - 1n;
var maxInt16 = 2n ** (16n - 1n) - 1n;
var maxInt24 = 2n ** (24n - 1n) - 1n;
var maxInt32 = 2n ** (32n - 1n) - 1n;
var maxInt40 = 2n ** (40n - 1n) - 1n;
var maxInt48 = 2n ** (48n - 1n) - 1n;
var maxInt56 = 2n ** (56n - 1n) - 1n;
var maxInt64 = 2n ** (64n - 1n) - 1n;
var maxInt72 = 2n ** (72n - 1n) - 1n;
var maxInt80 = 2n ** (80n - 1n) - 1n;
var maxInt88 = 2n ** (88n - 1n) - 1n;
var maxInt96 = 2n ** (96n - 1n) - 1n;
var maxInt104 = 2n ** (104n - 1n) - 1n;
var maxInt112 = 2n ** (112n - 1n) - 1n;
var maxInt120 = 2n ** (120n - 1n) - 1n;
var maxInt128 = 2n ** (128n - 1n) - 1n;
var maxInt136 = 2n ** (136n - 1n) - 1n;
var maxInt144 = 2n ** (144n - 1n) - 1n;
var maxInt152 = 2n ** (152n - 1n) - 1n;
var maxInt160 = 2n ** (160n - 1n) - 1n;
var maxInt168 = 2n ** (168n - 1n) - 1n;
var maxInt176 = 2n ** (176n - 1n) - 1n;
var maxInt184 = 2n ** (184n - 1n) - 1n;
var maxInt192 = 2n ** (192n - 1n) - 1n;
var maxInt200 = 2n ** (200n - 1n) - 1n;
var maxInt208 = 2n ** (208n - 1n) - 1n;
var maxInt216 = 2n ** (216n - 1n) - 1n;
var maxInt224 = 2n ** (224n - 1n) - 1n;
var maxInt232 = 2n ** (232n - 1n) - 1n;
var maxInt240 = 2n ** (240n - 1n) - 1n;
var maxInt248 = 2n ** (248n - 1n) - 1n;
var maxInt256 = 2n ** (256n - 1n) - 1n;
var minInt8 = -(2n ** (8n - 1n));
var minInt16 = -(2n ** (16n - 1n));
var minInt24 = -(2n ** (24n - 1n));
var minInt32 = -(2n ** (32n - 1n));
var minInt40 = -(2n ** (40n - 1n));
var minInt48 = -(2n ** (48n - 1n));
var minInt56 = -(2n ** (56n - 1n));
var minInt64 = -(2n ** (64n - 1n));
var minInt72 = -(2n ** (72n - 1n));
var minInt80 = -(2n ** (80n - 1n));
var minInt88 = -(2n ** (88n - 1n));
var minInt96 = -(2n ** (96n - 1n));
var minInt104 = -(2n ** (104n - 1n));
var minInt112 = -(2n ** (112n - 1n));
var minInt120 = -(2n ** (120n - 1n));
var minInt128 = -(2n ** (128n - 1n));
var minInt136 = -(2n ** (136n - 1n));
var minInt144 = -(2n ** (144n - 1n));
var minInt152 = -(2n ** (152n - 1n));
var minInt160 = -(2n ** (160n - 1n));
var minInt168 = -(2n ** (168n - 1n));
var minInt176 = -(2n ** (176n - 1n));
var minInt184 = -(2n ** (184n - 1n));
var minInt192 = -(2n ** (192n - 1n));
var minInt200 = -(2n ** (200n - 1n));
var minInt208 = -(2n ** (208n - 1n));
var minInt216 = -(2n ** (216n - 1n));
var minInt224 = -(2n ** (224n - 1n));
var minInt232 = -(2n ** (232n - 1n));
var minInt240 = -(2n ** (240n - 1n));
var minInt248 = -(2n ** (248n - 1n));
var minInt256 = -(2n ** (256n - 1n));
var maxUint8 = 2n ** 8n - 1n;
var maxUint16 = 2n ** 16n - 1n;
var maxUint24 = 2n ** 24n - 1n;
var maxUint32 = 2n ** 32n - 1n;
var maxUint40 = 2n ** 40n - 1n;
var maxUint48 = 2n ** 48n - 1n;
var maxUint56 = 2n ** 56n - 1n;
var maxUint64 = 2n ** 64n - 1n;
var maxUint72 = 2n ** 72n - 1n;
var maxUint80 = 2n ** 80n - 1n;
var maxUint88 = 2n ** 88n - 1n;
var maxUint96 = 2n ** 96n - 1n;
var maxUint104 = 2n ** 104n - 1n;
var maxUint112 = 2n ** 112n - 1n;
var maxUint120 = 2n ** 120n - 1n;
var maxUint128 = 2n ** 128n - 1n;
var maxUint136 = 2n ** 136n - 1n;
var maxUint144 = 2n ** 144n - 1n;
var maxUint152 = 2n ** 152n - 1n;
var maxUint160 = 2n ** 160n - 1n;
var maxUint168 = 2n ** 168n - 1n;
var maxUint176 = 2n ** 176n - 1n;
var maxUint184 = 2n ** 184n - 1n;
var maxUint192 = 2n ** 192n - 1n;
var maxUint200 = 2n ** 200n - 1n;
var maxUint208 = 2n ** 208n - 1n;
var maxUint216 = 2n ** 216n - 1n;
var maxUint224 = 2n ** 224n - 1n;
var maxUint232 = 2n ** 232n - 1n;
var maxUint240 = 2n ** 240n - 1n;
var maxUint248 = 2n ** 248n - 1n;
var maxUint256 = 2n ** 256n - 1n;

// ../-ai-dex-manager/node_modules/viem/_esm/errors/chain.js
var InvalidChainIdError = class extends BaseError {
  constructor({ chainId }) {
    super(typeof chainId === "number" ? `Chain ID "${chainId}" is invalid.` : "Chain ID is invalid.", { name: "InvalidChainIdError" });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/errors/node.js
var ExecutionRevertedError = class extends BaseError {
  constructor({ cause, message } = {}) {
    const reason = message?.replace("execution reverted: ", "")?.replace("execution reverted", "");
    super(`Execution reverted ${reason ? `with reason: ${reason}` : "for an unknown reason"}.`, {
      cause,
      name: "ExecutionRevertedError"
    });
  }
};
Object.defineProperty(ExecutionRevertedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 3
});
Object.defineProperty(ExecutionRevertedError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /execution reverted|gas required exceeds allowance/
});
var FeeCapTooHighError = class extends BaseError {
  constructor({ cause, maxFeePerGas } = {}) {
    super(`The fee cap (\`maxFeePerGas\`${maxFeePerGas ? ` = ${formatGwei(maxFeePerGas)} gwei` : ""}) cannot be higher than the maximum allowed value (2^256-1).`, {
      cause,
      name: "FeeCapTooHighError"
    });
  }
};
Object.defineProperty(FeeCapTooHighError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /max fee per gas higher than 2\^256-1|fee cap higher than 2\^256-1/
});
var FeeCapTooLowError = class extends BaseError {
  constructor({ cause, maxFeePerGas } = {}) {
    super(`The fee cap (\`maxFeePerGas\`${maxFeePerGas ? ` = ${formatGwei(maxFeePerGas)}` : ""} gwei) cannot be lower than the block base fee.`, {
      cause,
      name: "FeeCapTooLowError"
    });
  }
};
Object.defineProperty(FeeCapTooLowError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /max fee per gas less than block base fee|fee cap less than block base fee|transaction is outdated/
});
var NonceTooHighError = class extends BaseError {
  constructor({ cause, nonce } = {}) {
    super(`Nonce provided for the transaction ${nonce ? `(${nonce}) ` : ""}is higher than the next one expected.`, { cause, name: "NonceTooHighError" });
  }
};
Object.defineProperty(NonceTooHighError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /nonce too high/
});
var NonceTooLowError = class extends BaseError {
  constructor({ cause, nonce } = {}) {
    super([
      `Nonce provided for the transaction ${nonce ? `(${nonce}) ` : ""}is lower than the current nonce of the account.`,
      "Try increasing the nonce or find the latest nonce with `getTransactionCount`."
    ].join("\n"), { cause, name: "NonceTooLowError" });
  }
};
Object.defineProperty(NonceTooLowError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /nonce too low|transaction already imported|already known/
});
var NonceMaxValueError = class extends BaseError {
  constructor({ cause, nonce } = {}) {
    super(`Nonce provided for the transaction ${nonce ? `(${nonce}) ` : ""}exceeds the maximum allowed nonce.`, { cause, name: "NonceMaxValueError" });
  }
};
Object.defineProperty(NonceMaxValueError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /nonce has max value/
});
var InsufficientFundsError = class extends BaseError {
  constructor({ cause } = {}) {
    super([
      "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account."
    ].join("\n"), {
      cause,
      metaMessages: [
        "This error could arise when the account does not have enough funds to:",
        " - pay for the total gas fee,",
        " - pay for the value to send.",
        " ",
        "The cost of the transaction is calculated as `gas * gas fee + value`, where:",
        " - `gas` is the amount of gas needed for transaction to execute,",
        " - `gas fee` is the gas fee,",
        " - `value` is the amount of ether to send to the recipient."
      ],
      name: "InsufficientFundsError"
    });
  }
};
Object.defineProperty(InsufficientFundsError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /insufficient funds|exceeds transaction sender account balance/
});
var IntrinsicGasTooHighError = class extends BaseError {
  constructor({ cause, gas } = {}) {
    super(`The amount of gas ${gas ? `(${gas}) ` : ""}provided for the transaction exceeds the limit allowed for the block.`, {
      cause,
      name: "IntrinsicGasTooHighError"
    });
  }
};
Object.defineProperty(IntrinsicGasTooHighError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /intrinsic gas too high|gas limit reached/
});
var IntrinsicGasTooLowError = class extends BaseError {
  constructor({ cause, gas } = {}) {
    super(`The amount of gas ${gas ? `(${gas}) ` : ""}provided for the transaction is too low.`, {
      cause,
      name: "IntrinsicGasTooLowError"
    });
  }
};
Object.defineProperty(IntrinsicGasTooLowError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /intrinsic gas too low/
});
var TransactionTypeNotSupportedError = class extends BaseError {
  constructor({ cause }) {
    super("The transaction type is not supported for this chain.", {
      cause,
      name: "TransactionTypeNotSupportedError"
    });
  }
};
Object.defineProperty(TransactionTypeNotSupportedError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /transaction type not valid/
});
var TipAboveFeeCapError = class extends BaseError {
  constructor({ cause, maxPriorityFeePerGas, maxFeePerGas } = {}) {
    super([
      `The provided tip (\`maxPriorityFeePerGas\`${maxPriorityFeePerGas ? ` = ${formatGwei(maxPriorityFeePerGas)} gwei` : ""}) cannot be higher than the fee cap (\`maxFeePerGas\`${maxFeePerGas ? ` = ${formatGwei(maxFeePerGas)} gwei` : ""}).`
    ].join("\n"), {
      cause,
      name: "TipAboveFeeCapError"
    });
  }
};
Object.defineProperty(TipAboveFeeCapError, "nodeMessage", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: /max priority fee per gas higher than max fee per gas|tip higher than fee cap/
});

// ../-ai-dex-manager/node_modules/viem/_esm/utils/data/slice.js
function slice(value, start, end, { strict } = {}) {
  if (isHex(value, { strict: false }))
    return sliceHex(value, start, end, {
      strict
    });
  return sliceBytes(value, start, end, {
    strict
  });
}
function assertStartOffset(value, start) {
  if (typeof start === "number" && start > 0 && start > size(value) - 1)
    throw new SliceOffsetOutOfBoundsError({
      offset: start,
      position: "start",
      size: size(value)
    });
}
function assertEndOffset(value, start, end) {
  if (typeof start === "number" && typeof end === "number" && size(value) !== end - start) {
    throw new SliceOffsetOutOfBoundsError({
      offset: end,
      position: "end",
      size: size(value)
    });
  }
}
function sliceBytes(value_, start, end, { strict } = {}) {
  assertStartOffset(value_, start);
  const value = value_.slice(start, end);
  if (strict)
    assertEndOffset(value, start, end);
  return value;
}
function sliceHex(value_, start, end, { strict } = {}) {
  assertStartOffset(value_, start);
  const value = `0x${value_.replace("0x", "").slice((start ?? 0) * 2, (end ?? value_.length) * 2)}`;
  if (strict)
    assertEndOffset(value, start, end);
  return value;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/transaction/assertTransaction.js
function assertTransactionEIP7702(transaction) {
  const { authorizationList } = transaction;
  if (authorizationList) {
    for (const authorization of authorizationList) {
      const { chainId } = authorization;
      const address = authorization.address;
      if (!isAddress(address))
        throw new InvalidAddressError({ address });
      if (chainId < 0)
        throw new InvalidChainIdError({ chainId });
    }
  }
  assertTransactionEIP1559(transaction);
}
function assertTransactionEIP4844(transaction) {
  const { blobVersionedHashes } = transaction;
  if (blobVersionedHashes) {
    if (blobVersionedHashes.length === 0)
      throw new EmptyBlobError();
    for (const hash of blobVersionedHashes) {
      const size_ = size(hash);
      const version2 = hexToNumber2(slice(hash, 0, 1));
      if (size_ !== 32)
        throw new InvalidVersionedHashSizeError({ hash, size: size_ });
      if (version2 !== versionedHashVersionKzg)
        throw new InvalidVersionedHashVersionError({
          hash,
          version: version2
        });
    }
  }
  assertTransactionEIP1559(transaction);
}
function assertTransactionEIP1559(transaction) {
  const { chainId, maxPriorityFeePerGas, maxFeePerGas, to } = transaction;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (maxFeePerGas && maxFeePerGas > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas });
  if (maxPriorityFeePerGas && maxFeePerGas && maxPriorityFeePerGas > maxFeePerGas)
    throw new TipAboveFeeCapError({ maxFeePerGas, maxPriorityFeePerGas });
}
function assertTransactionEIP2930(transaction) {
  const { chainId, maxPriorityFeePerGas, gasPrice, maxFeePerGas, to } = transaction;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (maxPriorityFeePerGas || maxFeePerGas)
    throw new BaseError("`maxFeePerGas`/`maxPriorityFeePerGas` is not a valid EIP-2930 Transaction attribute.");
  if (gasPrice && gasPrice > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas: gasPrice });
}
function assertTransactionLegacy(transaction) {
  const { chainId, maxPriorityFeePerGas, gasPrice, maxFeePerGas, to } = transaction;
  if (to && !isAddress(to))
    throw new InvalidAddressError({ address: to });
  if (typeof chainId !== "undefined" && chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (maxPriorityFeePerGas || maxFeePerGas)
    throw new BaseError("`maxFeePerGas`/`maxPriorityFeePerGas` is not a valid Legacy Transaction attribute.");
  if (gasPrice && gasPrice > maxUint256)
    throw new FeeCapTooHighError({ maxFeePerGas: gasPrice });
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/transaction/getTransactionType.js
function getTransactionType(transaction) {
  if (transaction.type)
    return transaction.type;
  if (typeof transaction.authorizationList !== "undefined")
    return "eip7702";
  if (typeof transaction.blobs !== "undefined" || typeof transaction.blobVersionedHashes !== "undefined" || typeof transaction.maxFeePerBlobGas !== "undefined" || typeof transaction.sidecars !== "undefined")
    return "eip4844";
  if (typeof transaction.maxFeePerGas !== "undefined" || typeof transaction.maxPriorityFeePerGas !== "undefined") {
    return "eip1559";
  }
  if (typeof transaction.gasPrice !== "undefined") {
    if (typeof transaction.accessList !== "undefined")
      return "eip2930";
    return "legacy";
  }
  throw new InvalidSerializableTransactionError({ transaction });
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/transaction/serializeAccessList.js
function serializeAccessList(accessList) {
  if (!accessList || accessList.length === 0)
    return [];
  const serializedAccessList = [];
  for (let i = 0; i < accessList.length; i++) {
    const { address, storageKeys } = accessList[i];
    for (let j = 0; j < storageKeys.length; j++) {
      if (storageKeys[j].length - 2 !== 64) {
        throw new InvalidStorageKeySizeError({ storageKey: storageKeys[j] });
      }
    }
    if (!isAddress(address, { strict: false })) {
      throw new InvalidAddressError({ address });
    }
    serializedAccessList.push([address, storageKeys]);
  }
  return serializedAccessList;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/transaction/serializeTransaction.js
function serializeTransaction(transaction, signature) {
  const type = getTransactionType(transaction);
  if (type === "eip1559")
    return serializeTransactionEIP1559(transaction, signature);
  if (type === "eip2930")
    return serializeTransactionEIP2930(transaction, signature);
  if (type === "eip4844")
    return serializeTransactionEIP4844(transaction, signature);
  if (type === "eip7702")
    return serializeTransactionEIP7702(transaction, signature);
  return serializeTransactionLegacy(transaction, signature);
}
function serializeTransactionEIP7702(transaction, signature) {
  const { authorizationList, chainId, gas, nonce, to, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP7702(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedAuthorizationList = serializeAuthorizationList(authorizationList);
  return concatHex([
    "0x04",
    toRlp([
      numberToHex(chainId),
      nonce ? numberToHex(nonce) : "0x",
      maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
      maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
      gas ? numberToHex(gas) : "0x",
      to ?? "0x",
      value ? numberToHex(value) : "0x",
      data ?? "0x",
      serializedAccessList,
      serializedAuthorizationList,
      ...toYParitySignatureArray(transaction, signature)
    ])
  ]);
}
function serializeTransactionEIP4844(transaction, signature) {
  const { chainId, gas, nonce, to, value, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP4844(transaction);
  let blobVersionedHashes = transaction.blobVersionedHashes;
  let sidecars = transaction.sidecars;
  if (transaction.blobs && (typeof blobVersionedHashes === "undefined" || typeof sidecars === "undefined")) {
    const blobs2 = typeof transaction.blobs[0] === "string" ? transaction.blobs : transaction.blobs.map((x) => bytesToHex2(x));
    const kzg = transaction.kzg;
    const commitments2 = blobsToCommitments({
      blobs: blobs2,
      kzg
    });
    if (typeof blobVersionedHashes === "undefined")
      blobVersionedHashes = commitmentsToVersionedHashes({
        commitments: commitments2
      });
    if (typeof sidecars === "undefined") {
      const proofs2 = blobsToProofs({ blobs: blobs2, commitments: commitments2, kzg });
      sidecars = toBlobSidecars({ blobs: blobs2, commitments: commitments2, proofs: proofs2 });
    }
  }
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    maxFeePerBlobGas ? numberToHex(maxFeePerBlobGas) : "0x",
    blobVersionedHashes ?? [],
    ...toYParitySignatureArray(transaction, signature)
  ];
  const blobs = [];
  const commitments = [];
  const proofs = [];
  if (sidecars)
    for (let i = 0; i < sidecars.length; i++) {
      const { blob, commitment, proof } = sidecars[i];
      blobs.push(blob);
      commitments.push(commitment);
      proofs.push(proof);
    }
  return concatHex([
    "0x03",
    sidecars ? (
      // If sidecars are enabled, envelope turns into a "wrapper":
      toRlp([serializedTransaction, blobs, commitments, proofs])
    ) : (
      // If sidecars are disabled, standard envelope is used:
      toRlp(serializedTransaction)
    )
  ]);
}
function serializeTransactionEIP1559(transaction, signature) {
  const { chainId, gas, nonce, to, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = transaction;
  assertTransactionEIP1559(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    maxPriorityFeePerGas ? numberToHex(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? numberToHex(maxFeePerGas) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    ...toYParitySignatureArray(transaction, signature)
  ];
  return concatHex([
    "0x02",
    toRlp(serializedTransaction)
  ]);
}
function serializeTransactionEIP2930(transaction, signature) {
  const { chainId, gas, data, nonce, to, value, accessList, gasPrice } = transaction;
  assertTransactionEIP2930(transaction);
  const serializedAccessList = serializeAccessList(accessList);
  const serializedTransaction = [
    numberToHex(chainId),
    nonce ? numberToHex(nonce) : "0x",
    gasPrice ? numberToHex(gasPrice) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x",
    serializedAccessList,
    ...toYParitySignatureArray(transaction, signature)
  ];
  return concatHex([
    "0x01",
    toRlp(serializedTransaction)
  ]);
}
function serializeTransactionLegacy(transaction, signature) {
  const { chainId = 0, gas, data, nonce, to, value, gasPrice } = transaction;
  assertTransactionLegacy(transaction);
  let serializedTransaction = [
    nonce ? numberToHex(nonce) : "0x",
    gasPrice ? numberToHex(gasPrice) : "0x",
    gas ? numberToHex(gas) : "0x",
    to ?? "0x",
    value ? numberToHex(value) : "0x",
    data ?? "0x"
  ];
  if (signature) {
    const v = (() => {
      if (signature.v >= 35n) {
        const inferredChainId = (signature.v - 35n) / 2n;
        if (inferredChainId > 0)
          return signature.v;
        return 27n + (signature.v === 35n ? 0n : 1n);
      }
      if (chainId > 0)
        return BigInt(chainId * 2) + BigInt(35n + signature.v - 27n);
      const v2 = 27n + (signature.v === 27n ? 0n : 1n);
      if (signature.v !== v2)
        throw new InvalidLegacyVError({ v: signature.v });
      return v2;
    })();
    const r = trim(signature.r);
    const s = trim(signature.s);
    serializedTransaction = [
      ...serializedTransaction,
      numberToHex(v),
      r === "0x00" ? "0x" : r,
      s === "0x00" ? "0x" : s
    ];
  } else if (chainId > 0) {
    serializedTransaction = [
      ...serializedTransaction,
      numberToHex(chainId),
      "0x",
      "0x"
    ];
  }
  return toRlp(serializedTransaction);
}
function toYParitySignatureArray(transaction, signature_) {
  const signature = signature_ ?? transaction;
  const { v, yParity } = signature;
  if (typeof signature.r === "undefined")
    return [];
  if (typeof signature.s === "undefined")
    return [];
  if (typeof v === "undefined" && typeof yParity === "undefined")
    return [];
  const r = trim(signature.r);
  const s = trim(signature.s);
  const yParity_ = (() => {
    if (typeof yParity === "number")
      return yParity ? numberToHex(1) : "0x";
    if (v === 0n)
      return "0x";
    if (v === 1n)
      return numberToHex(1);
    return v === 27n ? "0x" : numberToHex(1);
  })();
  return [yParity_, r === "0x00" ? "0x" : r, s === "0x00" ? "0x" : s];
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/signTransaction.js
async function signTransaction(parameters) {
  const { privateKey, transaction, serializer = serializeTransaction } = parameters;
  const signableTransaction = (() => {
    if (transaction.type === "eip4844")
      return {
        ...transaction,
        sidecars: false
      };
    return transaction;
  })();
  const signature = await sign({
    hash: keccak256(await serializer(signableTransaction)),
    privateKey
  });
  return await serializer(transaction, signature);
}

// ../-ai-dex-manager/node_modules/viem/_esm/errors/abi.js
var AbiEncodingArrayLengthMismatchError = class extends BaseError {
  constructor({ expectedLength, givenLength, type }) {
    super([
      `ABI encoding array length mismatch for type ${type}.`,
      `Expected length: ${expectedLength}`,
      `Given length: ${givenLength}`
    ].join("\n"), { name: "AbiEncodingArrayLengthMismatchError" });
  }
};
var AbiEncodingBytesSizeMismatchError = class extends BaseError {
  constructor({ expectedSize, value }) {
    super(`Size of bytes "${value}" (bytes${size(value)}) does not match expected size (bytes${expectedSize}).`, { name: "AbiEncodingBytesSizeMismatchError" });
  }
};
var AbiEncodingLengthMismatchError = class extends BaseError {
  constructor({ expectedLength, givenLength }) {
    super([
      "ABI encoding params/values length mismatch.",
      `Expected length (params): ${expectedLength}`,
      `Given length (values): ${givenLength}`
    ].join("\n"), { name: "AbiEncodingLengthMismatchError" });
  }
};
var BytesSizeMismatchError = class extends BaseError {
  constructor({ expectedSize, givenSize }) {
    super(`Expected bytes${expectedSize}, got bytes${givenSize}.`, {
      name: "BytesSizeMismatchError"
    });
  }
};
var InvalidAbiEncodingTypeError = class extends BaseError {
  constructor(type, { docsPath }) {
    super([
      `Type "${type}" is not a valid encoding type.`,
      "Please provide a valid ABI type."
    ].join("\n"), { docsPath, name: "InvalidAbiEncodingType" });
  }
};
var InvalidArrayError = class extends BaseError {
  constructor(value) {
    super([`Value "${value}" is not a valid array.`].join("\n"), {
      name: "InvalidArrayError"
    });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/regex.js
var bytesRegex = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
var integerRegex = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;

// ../-ai-dex-manager/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js
function encodeAbiParameters(params, values) {
  if (params.length !== values.length)
    throw new AbiEncodingLengthMismatchError({
      expectedLength: params.length,
      givenLength: values.length
    });
  const preparedParams = prepareParams({
    params,
    values
  });
  const data = encodeParams(preparedParams);
  if (data.length === 0)
    return "0x";
  return data;
}
function prepareParams({ params, values }) {
  const preparedParams = [];
  for (let i = 0; i < params.length; i++) {
    preparedParams.push(prepareParam({ param: params[i], value: values[i] }));
  }
  return preparedParams;
}
function prepareParam({ param, value }) {
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return encodeArray(value, { length, param: { ...param, type } });
  }
  if (param.type === "tuple") {
    return encodeTuple(value, {
      param
    });
  }
  if (param.type === "address") {
    return encodeAddress(value);
  }
  if (param.type === "bool") {
    return encodeBool(value);
  }
  if (param.type.startsWith("uint") || param.type.startsWith("int")) {
    const signed = param.type.startsWith("int");
    const [, , size2 = "256"] = integerRegex.exec(param.type) ?? [];
    return encodeNumber(value, {
      signed,
      size: Number(size2)
    });
  }
  if (param.type.startsWith("bytes")) {
    return encodeBytes(value, { param });
  }
  if (param.type === "string") {
    return encodeString(value);
  }
  throw new InvalidAbiEncodingTypeError(param.type, {
    docsPath: "/docs/contract/encodeAbiParameters"
  });
}
function encodeParams(preparedParams) {
  let staticSize = 0;
  for (let i = 0; i < preparedParams.length; i++) {
    const { dynamic, encoded } = preparedParams[i];
    if (dynamic)
      staticSize += 32;
    else
      staticSize += size(encoded);
  }
  const staticParams = [];
  const dynamicParams = [];
  let dynamicSize = 0;
  for (let i = 0; i < preparedParams.length; i++) {
    const { dynamic, encoded } = preparedParams[i];
    if (dynamic) {
      staticParams.push(numberToHex(staticSize + dynamicSize, { size: 32 }));
      dynamicParams.push(encoded);
      dynamicSize += size(encoded);
    } else {
      staticParams.push(encoded);
    }
  }
  return concat([...staticParams, ...dynamicParams]);
}
function encodeAddress(value) {
  if (!isAddress(value))
    throw new InvalidAddressError({ address: value });
  return { dynamic: false, encoded: padHex(value.toLowerCase()) };
}
function encodeArray(value, { length, param }) {
  const dynamic = length === null;
  if (!Array.isArray(value))
    throw new InvalidArrayError(value);
  if (!dynamic && value.length !== length)
    throw new AbiEncodingArrayLengthMismatchError({
      expectedLength: length,
      givenLength: value.length,
      type: `${param.type}[${length}]`
    });
  let dynamicChild = false;
  const preparedParams = [];
  for (let i = 0; i < value.length; i++) {
    const preparedParam = prepareParam({ param, value: value[i] });
    if (preparedParam.dynamic)
      dynamicChild = true;
    preparedParams.push(preparedParam);
  }
  if (dynamic || dynamicChild) {
    const data = encodeParams(preparedParams);
    if (dynamic) {
      const length2 = numberToHex(preparedParams.length, { size: 32 });
      return {
        dynamic: true,
        encoded: preparedParams.length > 0 ? concat([length2, data]) : length2
      };
    }
    if (dynamicChild)
      return { dynamic: true, encoded: data };
  }
  return {
    dynamic: false,
    encoded: concat(preparedParams.map(({ encoded }) => encoded))
  };
}
function encodeBytes(value, { param }) {
  const [, paramSize] = param.type.split("bytes");
  const bytesSize = size(value);
  if (!paramSize) {
    let value_ = value;
    if (bytesSize % 32 !== 0)
      value_ = padHex(value_, {
        dir: "right",
        size: Math.ceil((value.length - 2) / 2 / 32) * 32
      });
    return {
      dynamic: true,
      encoded: concat([padHex(numberToHex(bytesSize, { size: 32 })), value_])
    };
  }
  if (bytesSize !== Number.parseInt(paramSize, 10))
    throw new AbiEncodingBytesSizeMismatchError({
      expectedSize: Number.parseInt(paramSize, 10),
      value
    });
  return { dynamic: false, encoded: padHex(value, { dir: "right" }) };
}
function encodeBool(value) {
  if (typeof value !== "boolean")
    throw new BaseError(`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
  return { dynamic: false, encoded: padHex(boolToHex(value)) };
}
function encodeNumber(value, { signed, size: size2 = 256 }) {
  if (typeof size2 === "number") {
    const max = 2n ** (BigInt(size2) - (signed ? 1n : 0n)) - 1n;
    const min = signed ? -max - 1n : 0n;
    if (value > max || value < min)
      throw new IntegerOutOfRangeError({
        max: max.toString(),
        min: min.toString(),
        signed,
        size: size2 / 8,
        value: value.toString()
      });
  }
  return {
    dynamic: false,
    encoded: numberToHex(value, {
      size: 32,
      signed
    })
  };
}
function encodeString(value) {
  const hexValue = stringToHex(value);
  const partsLength = Math.ceil(size(hexValue) / 32);
  const parts = [];
  for (let i = 0; i < partsLength; i++) {
    parts.push(padHex(slice(hexValue, i * 32, (i + 1) * 32), {
      dir: "right"
    }));
  }
  return {
    dynamic: true,
    encoded: concat([
      padHex(numberToHex(size(hexValue), { size: 32 })),
      ...parts
    ])
  };
}
function encodeTuple(value, { param }) {
  let dynamic = false;
  const preparedParams = [];
  for (let i = 0; i < param.components.length; i++) {
    const param_ = param.components[i];
    const index = Array.isArray(value) ? i : param_.name;
    const preparedParam = prepareParam({
      param: param_,
      value: value[index]
    });
    preparedParams.push(preparedParam);
    if (preparedParam.dynamic)
      dynamic = true;
  }
  return {
    dynamic,
    encoded: dynamic ? encodeParams(preparedParams) : concat(preparedParams.map(({ encoded }) => encoded))
  };
}
function getArrayComponents(type) {
  const matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches ? (
    // Return `null` if the array is dynamic.
    [matches[2] ? Number(matches[2]) : null, matches[1]]
  ) : void 0;
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/stringify.js
var stringify = (value, replacer, space) => JSON.stringify(value, (key, value_) => {
  const value2 = typeof value_ === "bigint" ? value_.toString() : value_;
  return typeof replacer === "function" ? replacer(key, value2) : value2;
}, space);

// ../-ai-dex-manager/node_modules/viem/_esm/errors/typedData.js
var InvalidDomainError = class extends BaseError {
  constructor({ domain }) {
    super(`Invalid domain "${stringify(domain)}".`, {
      metaMessages: ["Must be a valid EIP-712 domain."]
    });
  }
};
var InvalidPrimaryTypeError = class extends BaseError {
  constructor({ primaryType, types }) {
    super(`Invalid primary type \`${primaryType}\` must be one of \`${JSON.stringify(Object.keys(types))}\`.`, {
      docsPath: "/api/glossary/Errors#typeddatainvalidprimarytypeerror",
      metaMessages: ["Check that the primary type is a key in `types`."]
    });
  }
};
var InvalidStructTypeError = class extends BaseError {
  constructor({ type }) {
    super(`Struct type "${type}" is invalid.`, {
      metaMessages: ["Struct type must not be a Solidity type."],
      name: "InvalidStructTypeError"
    });
  }
};

// ../-ai-dex-manager/node_modules/viem/_esm/utils/typedData.js
function validateTypedData(parameters) {
  const { domain, message, primaryType, types } = parameters;
  const validateData = (struct, data) => {
    for (const param of struct) {
      const { name, type } = param;
      const value = data[name];
      const integerMatch = type.match(integerRegex);
      if (integerMatch && (typeof value === "number" || typeof value === "bigint")) {
        const [_type, base, size_] = integerMatch;
        numberToHex(value, {
          signed: base === "int",
          size: Number.parseInt(size_, 10) / 8
        });
      }
      if (type === "address" && typeof value === "string" && !isAddress(value))
        throw new InvalidAddressError({ address: value });
      const bytesMatch = type.match(bytesRegex);
      if (bytesMatch) {
        const [_type, size_] = bytesMatch;
        if (size_ && size(value) !== Number.parseInt(size_, 10))
          throw new BytesSizeMismatchError({
            expectedSize: Number.parseInt(size_, 10),
            givenSize: size(value)
          });
      }
      const struct2 = types[type];
      if (struct2) {
        validateReference(type);
        validateData(struct2, value);
      }
    }
  };
  if (types.EIP712Domain && domain) {
    if (typeof domain !== "object")
      throw new InvalidDomainError({ domain });
    validateData(types.EIP712Domain, domain);
  }
  if (primaryType !== "EIP712Domain") {
    if (types[primaryType])
      validateData(types[primaryType], message);
    else
      throw new InvalidPrimaryTypeError({ primaryType, types });
  }
}
function getTypesForEIP712Domain({ domain }) {
  return [
    typeof domain?.name === "string" && { name: "name", type: "string" },
    domain?.version && { name: "version", type: "string" },
    (typeof domain?.chainId === "number" || typeof domain?.chainId === "bigint") && {
      name: "chainId",
      type: "uint256"
    },
    domain?.verifyingContract && {
      name: "verifyingContract",
      type: "address"
    },
    domain?.salt && { name: "salt", type: "bytes32" }
  ].filter(Boolean);
}
function validateReference(type) {
  if (type === "address" || type === "bool" || type === "string" || type.startsWith("bytes") || type.startsWith("uint") || type.startsWith("int"))
    throw new InvalidStructTypeError({ type });
}

// ../-ai-dex-manager/node_modules/viem/_esm/utils/signature/hashTypedData.js
function hashTypedData(parameters) {
  const { domain = {}, message, primaryType } = parameters;
  const types = {
    EIP712Domain: getTypesForEIP712Domain({ domain }),
    ...parameters.types
  };
  validateTypedData({
    domain,
    message,
    primaryType,
    types
  });
  const parts = ["0x1901"];
  if (domain)
    parts.push(hashDomain({
      domain,
      types
    }));
  if (primaryType !== "EIP712Domain")
    parts.push(hashStruct({
      data: message,
      primaryType,
      types
    }));
  return keccak256(concat(parts));
}
function hashDomain({ domain, types }) {
  return hashStruct({
    data: domain,
    primaryType: "EIP712Domain",
    types
  });
}
function hashStruct({ data, primaryType, types }) {
  const encoded = encodeData({
    data,
    primaryType,
    types
  });
  return keccak256(encoded);
}
function encodeData({ data, primaryType, types }) {
  const encodedTypes = [{ type: "bytes32" }];
  const encodedValues = [hashType({ primaryType, types })];
  for (const field of types[primaryType]) {
    const [type, value] = encodeField({
      types,
      name: field.name,
      type: field.type,
      value: data[field.name]
    });
    encodedTypes.push(type);
    encodedValues.push(value);
  }
  return encodeAbiParameters(encodedTypes, encodedValues);
}
function hashType({ primaryType, types }) {
  const encodedHashType = toHex(encodeType({ primaryType, types }));
  return keccak256(encodedHashType);
}
function encodeType({ primaryType, types }) {
  let result = "";
  const unsortedDeps = findTypeDependencies({ primaryType, types });
  unsortedDeps.delete(primaryType);
  const deps = [primaryType, ...Array.from(unsortedDeps).sort()];
  for (const type of deps) {
    result += `${type}(${types[type].map(({ name, type: t }) => `${t} ${name}`).join(",")})`;
  }
  return result;
}
function findTypeDependencies({ primaryType: primaryType_, types }, results = /* @__PURE__ */ new Set()) {
  const match = primaryType_.match(/^\w*/u);
  const primaryType = match?.[0];
  if (results.has(primaryType) || types[primaryType] === void 0) {
    return results;
  }
  results.add(primaryType);
  for (const field of types[primaryType]) {
    findTypeDependencies({ primaryType: field.type, types }, results);
  }
  return results;
}
function encodeField({ types, name, type, value }) {
  if (types[type] !== void 0) {
    return [
      { type: "bytes32" },
      keccak256(encodeData({ data: value, primaryType: type, types }))
    ];
  }
  if (type === "bytes")
    return [{ type: "bytes32" }, keccak256(value)];
  if (type === "string")
    return [{ type: "bytes32" }, keccak256(toHex(value))];
  if (type.lastIndexOf("]") === type.length - 1) {
    const parsedType = type.slice(0, type.lastIndexOf("["));
    const typeValuePairs = value.map((item) => encodeField({
      name,
      type: parsedType,
      types,
      value: item
    }));
    return [
      { type: "bytes32" },
      keccak256(encodeAbiParameters(typeValuePairs.map(([t]) => t), typeValuePairs.map(([, v]) => v)))
    ];
  }
  return [{ type }, value];
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/utils/signTypedData.js
async function signTypedData(parameters) {
  const { privateKey, ...typedData } = parameters;
  return await sign({
    hash: hashTypedData(typedData),
    privateKey,
    to: "hex"
  });
}

// ../-ai-dex-manager/node_modules/viem/_esm/accounts/privateKeyToAccount.js
function privateKeyToAccount(privateKey, options = {}) {
  const { nonceManager } = options;
  const publicKey = toHex(secp256k1.getPublicKey(privateKey.slice(2), false));
  const address = publicKeyToAddress(publicKey);
  const account = toAccount({
    address,
    nonceManager,
    async sign({ hash }) {
      return sign({ hash, privateKey, to: "hex" });
    },
    async signAuthorization(authorization) {
      return signAuthorization({ ...authorization, privateKey });
    },
    async signMessage({ message }) {
      return signMessage({ message, privateKey });
    },
    async signTransaction(transaction, { serializer } = {}) {
      return signTransaction({ privateKey, transaction, serializer });
    },
    async signTypedData(typedData) {
      return signTypedData({ ...typedData, privateKey });
    }
  });
  return {
    ...account,
    publicKey,
    source: "privateKey"
  };
}

// lib/disdex-aster-global-rate-budget.ts
var import_promises = require("node:fs/promises");
var import_node_crypto = require("node:crypto");
var import_node_path = require("node:path");
var ASTER_GLOBAL_RATE_BUDGET_SCHEMA = "disdex-aster-rate-budget/v1";
var sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
var errorCode = (error) => error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
var transientLockRace = (error) => ["ENOENT", "ENOTEMPTY", "EPERM", "EBUSY"].includes(errorCode(error));
var LOCK_OWNER_SCHEMA = "disdex-aster-rate-budget-lock/v1";
var LOCK_RECOVERY_GRACE_MS = 5e3;
function validLockOwner(value) {
  if (!value || typeof value !== "object") return false;
  const owner = value;
  const pid = owner.pid;
  const createdAt = owner.createdAt;
  return owner.schema === LOCK_OWNER_SCHEMA && typeof pid === "number" && Number.isInteger(pid) && pid > 0 && typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0 && typeof owner.token === "string" && owner.token.length > 0 && (owner.processStartTicks === void 0 || typeof owner.processStartTicks === "string" && /^\d+$/.test(owner.processStartTicks));
}
async function readLockOwner(lockPath) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(lockPath, "owner.json"), "utf8"));
    return validLockOwner(parsed) ? parsed : void 0;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return void 0;
    return void 0;
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}
async function processStartTicks(pid) {
  if (process.platform !== "linux") return void 0;
  try {
    const raw = await (0, import_promises.readFile)(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen < 0) return void 0;
    const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
    const value = fields[19];
    return value && /^\d+$/.test(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
async function newLockOwner() {
  const startTicks = await processStartTicks(process.pid);
  return {
    schema: LOCK_OWNER_SCHEMA,
    pid: process.pid,
    createdAt: Date.now(),
    token: (0, import_node_crypto.randomUUID)(),
    ...startTicks ? { processStartTicks: startTicks } : {}
  };
}
async function lockIsStale(lockPath) {
  const owner = await readLockOwner(lockPath);
  if (owner) {
    if (!processAlive(owner.pid)) return true;
    if (owner.processStartTicks) {
      const currentStartTicks = await processStartTicks(owner.pid);
      if (currentStartTicks && currentStartTicks !== owner.processStartTicks) return true;
    }
    return false;
  }
  try {
    const metadata = await (0, import_promises.stat)(lockPath);
    return Date.now() - metadata.mtimeMs > LOCK_RECOVERY_GRACE_MS;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}
async function acquireLockGenerationMutex(lockPath, deadline) {
  const recoveryPath = `${lockPath}.recovery`;
  const owner = await newLockOwner();
  while (true) {
    try {
      await (0, import_promises.mkdir)(recoveryPath, { mode: 448 });
      try {
        await writeLockOwner(recoveryPath, owner);
        return { path: recoveryPath, owner };
      } catch (error) {
        await (0, import_promises.rm)(recoveryPath, { recursive: true, force: true }).catch(() => void 0);
        if (!transientLockRace(error)) throw error;
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST" && !transientLockRace(error)) throw error;
      if (errorCode(error) === "EEXIST" && await lockIsStale(recoveryPath)) {
        try {
          await (0, import_promises.rm)(recoveryPath, { recursive: true, force: true });
          continue;
        } catch (recoveryError) {
          if (!transientLockRace(recoveryError)) throw recoveryError;
        }
      }
    }
    if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
    await sleep(5);
  }
}
async function releaseLockGenerationMutex(recovery) {
  const current = await readLockOwner(recovery.path);
  if (!current || current.token !== recovery.owner.token) return;
  const releasedPath = `${recovery.path}.released.${recovery.owner.token}`;
  const releaseDeadline = Date.now() + 5e3;
  while (true) {
    try {
      await (0, import_promises.rename)(recovery.path, releasedPath);
      break;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (!transientLockRace(error) || Date.now() >= releaseDeadline) {
        throw new Error("ASTER_GLOBAL_RATE_BUDGET_RECOVERY_LOCK_RELEASE_FAILED");
      }
      await sleep(5);
    }
  }
  await (0, import_promises.rm)(releasedPath, { recursive: true, force: true });
}
async function writeLockOwner(lockPath, owner) {
  await (0, import_promises.writeFile)((0, import_node_path.join)(lockPath, "owner.json"), `${JSON.stringify(owner)}
`, { encoding: "utf8", mode: 384 });
}
async function readBudget(path) {
  try {
    return JSON.parse(await (0, import_promises.readFile)(path, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}
async function atomicWriteBudget(path, state) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await (0, import_promises.writeFile)(temporary, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 432 });
    await (0, import_promises.rename)(temporary, path);
    await (0, import_promises.chmod)(path, 432);
  } finally {
    await (0, import_promises.rm)(temporary, { force: true }).catch(() => void 0);
  }
}
async function acquireBudgetLock(lockPath, maxQueueMs) {
  const deadline = Date.now() + maxQueueMs;
  const owner = await newLockOwner();
  while (true) {
    try {
      await (0, import_promises.mkdir)(lockPath, { mode: 448 });
      while (true) {
        try {
          await writeLockOwner(lockPath, owner);
          return owner;
        } catch (error) {
          if (!transientLockRace(error)) {
            await (0, import_promises.rm)(lockPath, { recursive: true, force: true }).catch(() => void 0);
            throw error;
          }
          if (errorCode(error) === "ENOENT") break;
          if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
          await sleep(5);
        }
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST" && !transientLockRace(error)) throw error;
      if (errorCode(error) === "EEXIST" && await lockIsStale(lockPath)) {
        const recovery = await acquireLockGenerationMutex(lockPath, deadline);
        try {
          if (await lockIsStale(lockPath)) {
            const stalePath = `${lockPath}.stale.${(0, import_node_crypto.randomUUID)()}`;
            try {
              await (0, import_promises.rename)(lockPath, stalePath);
              await (0, import_promises.rm)(stalePath, { recursive: true, force: true });
            } catch (recoveryError) {
              if (errorCode(recoveryError) !== "ENOENT" && !transientLockRace(recoveryError)) throw recoveryError;
            }
          }
        } finally {
          await releaseLockGenerationMutex(recovery);
        }
        continue;
      }
    }
    if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
    await sleep(5);
  }
}
async function releaseBudgetLock(lockPath, owner) {
  const current = await readLockOwner(lockPath);
  if (!current || current.token !== owner.token) return;
  const releasedPath = `${lockPath}.released.${owner.token}`;
  const deadline = Date.now() + 5e3;
  while (true) {
    try {
      await (0, import_promises.rename)(lockPath, releasedPath);
      break;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (!transientLockRace(error) || Date.now() >= deadline) {
        throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_RELEASE_FAILED");
      }
      await sleep(5);
    }
  }
  await (0, import_promises.rm)(releasedPath, { recursive: true, force: true });
}
async function reserveAsterGlobalRateSlot(options) {
  const path = (0, import_node_path.resolve)(options.path);
  const lockPath = `${path}.lock`;
  if (!Number.isFinite(options.minIntervalMs) || !Number.isFinite(options.maxQueueMs) || options.weight !== void 0 && !Number.isFinite(options.weight) || options.nowMs !== void 0 && !Number.isFinite(options.nowMs)) {
    throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  }
  const minIntervalMs = Math.max(1, Math.min(1e3, Math.floor(options.minIntervalMs)));
  const maxQueueMs = Math.max(minIntervalMs, Math.min(3e4, Math.floor(options.maxQueueMs)));
  const weight = Math.max(1, Math.min(100, Math.floor(options.weight ?? 1)));
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  const owner = await acquireBudgetLock(lockPath, maxQueueMs);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) {
      throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    }
    const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const nextAllowedAt = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(nextAllowedAt) || nextAllowedAt < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const permitAt = Math.max(now, nextAllowedAt);
    const waitMs = permitAt - now;
    if (waitMs > maxQueueMs) throw new Error(`ASTER_GLOBAL_RATE_BUDGET_SATURATED:${waitMs}`);
    const state = {
      schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA,
      nextAllowedAt: permitAt + minIntervalMs * weight,
      updatedAt: now,
      pid: process.pid
    };
    await atomicWriteBudget(path, state);
    return { permitAt, waitMs, nextAllowedAt: state.nextAllowedAt };
  } finally {
    await releaseBudgetLock(lockPath, owner);
  }
}
async function deferAsterGlobalRateBudget(options) {
  if (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 0 || options.nowMs !== void 0 && !Number.isFinite(options.nowMs)) throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  const path = (0, import_node_path.resolve)(options.path);
  const lockPath = `${path}.lock`;
  const now = options.nowMs ?? Date.now();
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  const owner = await acquireBudgetLock(lockPath, 2e3);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const existing = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(existing) || existing < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const cooldownUntil = Math.max(existing, now + Math.floor(options.cooldownMs));
    await atomicWriteBudget(path, { schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA, nextAllowedAt: cooldownUntil, updatedAt: now, pid: process.pid, cooldownUntil, lastRateLimitStatus: options.status });
    return { cooldownUntil };
  } finally {
    await releaseBudgetLock(lockPath, owner);
  }
}
async function waitForAsterGlobalRateSlot(weight = 1) {
  const path = String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim();
  if (!path) return;
  const minIntervalMs = Number(process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS || 50);
  const maxQueueMs = Number(process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS || 5e3);
  const slot = await reserveAsterGlobalRateSlot({ path, minIntervalMs, maxQueueMs, weight });
  if (slot.waitMs > 0) await sleep(slot.waitMs);
}

// lib/aster-v3-client.ts
var AsterApiError = class extends Error {
  constructor(input) {
    super(input.message);
    this.name = "AsterApiError";
    this.path = input.path;
    this.status = input.status;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
    this.executionUnknown = input.executionUnknown === true;
    this.responseBody = input.responseBody;
  }
};
function normalizeBaseUrl(value) {
  return String(value || "https://fapi.asterdex.com").replace(/\/+$/, "");
}
function normalizePrivateKey(value) {
  if (!value) return void 0;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("ASTER_API_PRIVATE_KEY must be a 32-byte hex private key.");
  return normalized;
}
function valueToString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
function encodeParams2(params) {
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null || value === "") continue;
    encoded.append(key, valueToString(value));
  }
  return encoded.toString();
}
function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function parseErrorCode(payload) {
  if (!payload || typeof payload !== "object") return void 0;
  const value = Number(payload.code);
  return Number.isFinite(value) ? value : void 0;
}
function parseErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload.msg ?? payload.message;
  return typeof value === "string" && value ? value : fallback;
}
function asterFuturesRequestWeight(method, path, params = {}) {
  const symbol = typeof params.symbol === "string" && params.symbol.length > 0;
  if (path === "/fapi/v3/balance" || path === "/fapi/v3/positionRisk" || path === "/fapi/v3/account" || path === "/fapi/v3/accountWithJoinMargin") return 5;
  if (path === "/fapi/v3/openOrders") return symbol ? 1 : 40;
  if (path === "/fapi/v3/income") return 30;
  if (path === "/fapi/v3/userTrades") return 5;
  if (path === "/fapi/v3/fundingRate") return 1;
  if (path === "/fapi/v3/ticker/24hr") return symbol ? 1 : 40;
  if (path === "/fapi/v3/ticker/price" || path === "/fapi/v3/ticker/bookTicker") return symbol ? 1 : 2;
  if (path === "/fapi/v3/klines") {
    const limit = Number(params.limit ?? 500);
    if (!Number.isFinite(limit) || limit <= 0) return 10;
    if (limit < 100) return 1;
    if (limit < 500) return 2;
    if (limit <= 1e3) return 5;
    return 10;
  }
  if (["/fapi/v3/ping", "/fapi/v3/time", "/fapi/v3/exchangeInfo", "/fapi/v3/order", "/fapi/v3/allOpenOrders", "/fapi/v3/leverage", "/fapi/v3/marginType"].includes(path)) return 1;
  return 100;
}
function retryAfterFromHeaders(headers) {
  const raw = headers.get("retry-after");
  if (!raw) return void 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : void 0;
}
function isReadOnlyRateLimitError(error) {
  if (error.status === 418) return false;
  if (error.status === 429) return true;
  if (error.code === -1003) return true;
  return /too many requests|rate[ -]?limit|request weight/i.test(error.message);
}
function sleep2(ms) {
  return new Promise((resolve4) => setTimeout(resolve4, ms));
}
var MonotonicMicrosecondNonce = class {
  constructor() {
    this.last = 0n;
  }
  next() {
    const now = BigInt(Date.now()) * 1000n;
    this.last = now > this.last ? now : this.last + 1n;
    return this.last.toString();
  }
};
var AsterV3Client = class {
  constructor(options = {}) {
    this.nonce = new MonotonicMicrosecondNonce();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.userAddress = options.userAddress?.trim();
    const privateKey = normalizePrivateKey(options.privateKey);
    this.account = privateKey ? privateKeyToAccount(privateKey) : void 0;
    this.signerAddress = this.account?.address;
    this.timeoutMs = Math.max(1e3, options.requestTimeoutMs ?? 1e4);
    this.recvWindowMs = Math.min(5e3, Math.max(1e3, options.recvWindowMs ?? 5e3));
    this.readOnlyRateLimitMaxRetries = Math.max(0, Math.min(5, Math.floor(options.readOnlyRateLimitMaxRetries ?? 3)));
    this.readOnlyRateLimitBackoffBaseMs = Math.max(1, Math.min(6e4, Math.floor(options.readOnlyRateLimitBackoffBaseMs ?? 1e3)));
    this.readOnlyRateLimitBackoffMaxMs = Math.max(this.readOnlyRateLimitBackoffBaseMs, Math.min(12e4, Math.floor(options.readOnlyRateLimitBackoffMaxMs ?? 12e4)));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent || "DisDex-Win80-LiveRunner/1.0";
  }
  hasTradingCredentials() {
    return Boolean(this.account && this.signerAddress && this.userAddress);
  }
  async signParams(params) {
    if (!this.account || !this.signerAddress || !this.userAddress) throw new Error("Aster V3 signed request requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    const signedParams = { ...params, recvWindow: params.recvWindow ?? this.recvWindowMs, nonce: this.nonce.next(), user: this.userAddress, signer: this.signerAddress };
    const message = encodeParams2(signedParams);
    const signature = await this.account.signTypedData({
      domain: { name: "AsterSignTransaction", version: "1", chainId: 1666, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Message: [{ name: "msg", type: "string" }] },
      primaryType: "Message",
      message: { msg: message }
    });
    return { signedParams, signature };
  }
  async request(input) {
    const method = input.method;
    const params = input.params || {};
    let retries = 0;
    while (true) {
      try {
        await waitForAsterGlobalRateSlot(asterFuturesRequestWeight(method, input.path, params));
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), this.timeoutMs);
        try {
          let query = "";
          let body;
          if (input.signed) {
            const signed = await this.signParams(params);
            const payload2 = encodeParams2({ ...signed.signedParams, signature: signed.signature });
            if (method === "GET") query = payload2;
            else body = payload2;
          } else {
            const payload2 = encodeParams2(params);
            if (method === "GET") query = payload2;
            else body = payload2;
          }
          const url = `${this.baseUrl}${input.path}${query ? `?${query}` : ""}`;
          const response = await this.fetchImpl(url, { method, body, signal: abort.signal, headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": this.userAgent }, cache: "no-store" });
          const text = await response.text();
          const payload = parseJsonSafe(text);
          if (!response.ok) {
            const executionUnknown = response.status === 503 && input.orderMutation === true;
            const retryAfterMs = retryAfterFromHeaders(response.headers);
            const budgetPath = String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim();
            if (budgetPath && (response.status === 429 || response.status === 418)) {
              const minimumCooldownMs = response.status === 418 ? 12e4 : 6e4;
              await deferAsterGlobalRateBudget({ path: budgetPath, cooldownMs: Math.max(minimumCooldownMs, retryAfterMs ?? 0), status: response.status });
            }
            throw new AsterApiError({ path: input.path, message: parseErrorMessage(payload, `Aster HTTP ${response.status}`), status: response.status, code: parseErrorCode(payload), retryAfterMs, executionUnknown, responseBody: payload });
          }
          return payload;
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        const canRetry = input.orderMutation !== true && !String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim() && retries < this.readOnlyRateLimitMaxRetries && error instanceof AsterApiError && isReadOnlyRateLimitError(error);
        if (canRetry) {
          const exponential = this.readOnlyRateLimitBackoffBaseMs * 2 ** retries;
          const waitMs = Math.min(this.readOnlyRateLimitBackoffMaxMs, Math.max(exponential, error.retryAfterMs ?? 0));
          retries += 1;
          await sleep2(waitMs);
          continue;
        }
        if (error instanceof AsterApiError) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new AsterApiError({ message: `Aster request timeout after ${this.timeoutMs}ms`, status: 0, executionUnknown: input.orderMutation === true });
        throw error;
      }
    }
  }
  ping() {
    return this.request({ method: "GET", path: "/fapi/v3/ping" });
  }
  getServerTime() {
    return this.request({ method: "GET", path: "/fapi/v3/time" });
  }
  getExchangeInfo() {
    return this.request({ method: "GET", path: "/fapi/v3/exchangeInfo" });
  }
  getPriceTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/price", params: symbol ? { symbol } : void 0 });
  }
  getBookTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/bookTicker", params: symbol ? { symbol } : void 0 });
  }
  get24hTickers(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/ticker/24hr", params: symbol ? { symbol } : void 0 });
  }
  getKlines(symbol, interval, limit = 200, range = {}) {
    return this.request({
      method: "GET",
      path: "/fapi/v3/klines",
      params: { symbol, interval, limit, startTime: range.startTime, endTime: range.endTime }
    });
  }
  getBalances() {
    return this.request({ method: "GET", path: "/fapi/v3/balance", signed: true });
  }
  getPositions(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/positionRisk", params: symbol ? { symbol } : void 0, signed: true });
  }
  getOpenOrders(symbol) {
    return this.request({ method: "GET", path: "/fapi/v3/openOrders", params: symbol ? { symbol } : void 0, signed: true });
  }
  setMarginType(symbol, marginType) {
    return this.request({ method: "POST", path: "/fapi/v3/marginType", params: { symbol, marginType }, signed: true, orderMutation: true });
  }
  setLeverage(symbol, leverage) {
    return this.request({ method: "POST", path: "/fapi/v3/leverage", params: { symbol, leverage }, signed: true, orderMutation: true });
  }
  getOrder(symbol, clientOrderId) {
    return this.request({ method: "GET", path: "/fapi/v3/order", params: { symbol, origClientOrderId: clientOrderId }, signed: true });
  }
  getIncomeHistory(input = {}) {
    return this.request({ method: "GET", path: "/fapi/v3/income", params: { ...input, limit: Math.min(1e3, Math.max(1, input.limit ?? 1e3)) }, signed: true });
  }
  getUserTrades(symbol, input = {}) {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    if (!normalizedSymbol) throw new Error("ASTER_USER_TRADES_SYMBOL_REQUIRED");
    return this.request({
      method: "GET",
      path: "/fapi/v3/userTrades",
      params: { symbol: normalizedSymbol, ...input, limit: Math.min(1e3, Math.max(1, input.limit ?? 1e3)) },
      signed: true
    });
  }
  placeMarketOrder(order) {
    return this.request({ method: "POST", path: "/fapi/v3/order", params: { symbol: order.symbol, side: order.side, type: "MARKET", quantity: order.quantity, positionSide: order.positionSide || "BOTH", reduceOnly: order.reduceOnly === true ? "true" : "false", newClientOrderId: order.newClientOrderId, newOrderRespType: order.newOrderRespType || "RESULT" }, signed: true, orderMutation: true });
  }
  placeConditionalOrder(order) {
    return this.request({ method: "POST", path: "/fapi/v3/order", params: { symbol: order.symbol, side: order.side, type: order.type, quantity: order.quantity, stopPrice: order.stopPrice, positionSide: order.positionSide || "BOTH", reduceOnly: "true", newClientOrderId: order.newClientOrderId, workingType: order.workingType || "MARK_PRICE", priceProtect: order.priceProtect === true ? "TRUE" : "FALSE", newOrderRespType: order.newOrderRespType || "ACK" }, signed: true, orderMutation: true });
  }
  cancelOrder(symbol, clientOrderId) {
    return this.request({ method: "DELETE", path: "/fapi/v3/order", params: { symbol, origClientOrderId: clientOrderId }, signed: true, orderMutation: true });
  }
  placeStopMarketOrder(order) {
    return this.request({
      method: "POST",
      path: "/fapi/v3/order",
      params: {
        symbol: order.symbol,
        side: order.side,
        type: "STOP_MARKET",
        quantity: order.quantity,
        stopPrice: order.stopPrice,
        positionSide: order.positionSide || "BOTH",
        reduceOnly: "true",
        workingType: "MARK_PRICE",
        priceProtect: "TRUE",
        newClientOrderId: order.newClientOrderId,
        newOrderRespType: order.newOrderRespType || "RESULT"
      },
      signed: true,
      orderMutation: true
    });
  }
};

// config/v52V50Runtime.json
var v52V50Runtime_default = {
  policyId: "V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20",
  strategy: "V50_POST_OPEN_BASIS",
  windowPolicy: "POST_EARLY3",
  windowsNy: ["11:30", "12:30", "13:30"],
  direction: "BOTH",
  minimumEntryBasisBps: 60,
  convergenceBps: 20,
  basisStopMultiple: 1.75,
  minimumNetEdgeBps: 7.5,
  maximumRoundTripCostBps: 60,
  maximumSpreadBps: 20,
  maximumHoldingHours: 3,
  stockAggregateGross: 1.98,
  slotGross: 1.64
};

// config/integratedProductionRiskPolicy.ts
var Q102_CAUSAL_V4_FAMILY_GROSS = Object.freeze({
  HIGH_VOL: 1.661,
  MR: 1,
  BRK: 2.465,
  REV: 2.5,
  PB: 2.5
});
var INTEGRATED_PRODUCTION_RISK_POLICY = Object.freeze({
  v12BaseAggregateGross: 1.5,
  v12DynamicAggregateGrossCap: 2,
  v12PerPositionGrossCap: 1,
  v12MaximumPositions: 3,
  fetResidualMaximumGross: 1.25,
  fetResidualMinimumGross: 0.05,
  penguMaximumGross: 0.85,
  q102FamilyGross: Q102_CAUSAL_V4_FAMILY_GROSS,
  q102CausalV4MaximumGross: 3,
  q102MaximumPositions: 1,
  cryptoGrossCap: 3,
  stockGrossCap: Number(v52V50Runtime_default.stockAggregateGross),
  stockSlotGrossCap: Number(v52V50Runtime_default.slotGross),
  totalGrossCap: 3.5,
  cryptoDailyLossPct: 7.5,
  stockDailyLossPct: 3.5,
  killSwitchRecoveryGraceMs: 10 * 6e4,
  requiredAsterLeverage: 5,
  requiredAsterMarginType: "cross",
  v50: Object.freeze(v52V50Runtime_default)
});

// config/disdexStrictBt33404708902Runtime.ts
var STRICT_BT33404708902 = Object.freeze({
  sourceRun: "33404708902",
  sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
  grossPolicy: "BASE_PRIORITY_CRYPTO_AND_TOTAL_RESIDUAL_GROSS_SHRINK",
  resizePnlAccounting: "MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN",
  sourceValidation: "ALL_102_FROZEN_RESEARCH_1H_OPEN_CROSSCHECK_FAIL_CLOSED",
  quality102PositionCap: 1.5,
  quality102CausalV1PositionCap: 1.5,
  cryptoGrossCap: 3,
  totalGrossCap: 3.5,
  stockGrossCap: 1.5,
  v12MaximumGross: 1.5,
  v12PerPositionGrossCap: 1,
  v12MaximumPositions: 1,
  v12LiveMaximumPositions: 2,
  penguMaximumGross: 0.85,
  quality102LiveSelectorParity: false,
  quality102LiveBlockedFailClosed: true,
  liveActivated: false,
  researchOnly: true
});

// lib/disdex-quality102-causal-selector.ts
var QUALITY102_CAUSAL_CAPABILITIES = Object.freeze({
  s1s2RawGeneratorProven: false,
  s34RawGeneratorProven: false,
  selectorImplemented: false
});
var QUALITY102_RECOVERY_CAPABILITIES = Object.freeze({
  highVolRawGeneratorImplemented: true,
  highVolHistoricalParity: Object.freeze({
    oldUniverseExact: Object.freeze({ expected: 137, matched: 137 }),
    expandedUniverseExact: Object.freeze({ expected: 388, matched: 388 }),
    combinedRawExpected: 525
  }),
  highVol525To30SelectorProven: false,
  recoveredHighVolSelectedShape: Object.freeze({ stage1: 8, stage2: 22, total: 30 }),
  pbMrRevPostGenerationRecovered: true,
  brkStrengthFormulaProven: false,
  quality124TransformRecovered: true,
  oneSlotRouterRecovered: true,
  selectorImplemented: false
});
var QUALITY102_RECOVERED_POST_GENERATION_SOURCE = Object.freeze({
  commit: "450f8fae800d3f509ef868ab035f0cd731216279",
  script: "scripts/research_quality102_selector_recovered.py",
  scope: "POST_GENERATION_TRANSFORMS_QUALITY_GATE_AND_ONE_SLOT_ONLY"
});
var QUALITY102_DEFAULT_MAX_DATA_AGE_MS = 65 * 6e4;
function evaluateS34QualityGate(input) {
  if (input.side !== -1 && input.side !== 1) return { accepted: false, reason: "INVALID_S34_SIDE" };
  if (!Number.isFinite(input.strength) || !Number.isFinite(input.ret14)) {
    return { accepted: false, reason: "INVALID_S34_NUMERIC_INPUT" };
  }
  if (typeof input.variant !== "string" || input.variant.trim().length === 0) {
    return { accepted: false, reason: "INVALID_S34_VARIANT" };
  }
  switch (input.family) {
    case "PB":
      return {
        accepted: input.variant !== "PB168_0.1_P24_0.04_H12",
        reason: "PB_WEAK_VARIANT_REMOVED"
      };
    case "MR":
      return {
        accepted: input.side === -1 || input.ret14 >= -0.025,
        reason: "MR_REGIME_GATE"
      };
    case "BRK":
      return {
        accepted: input.strength >= 0.03 && input.side * input.ret14 >= -0.05,
        reason: "BRK_QUALITY_GATE"
      };
    case "REV":
      return { accepted: true, reason: "UNCHANGED" };
    default:
      return { accepted: false, reason: "UNKNOWN_S34_FAMILY" };
  }
}
function v4FiniteDevelopment(input) {
  return Number.isFinite(input.margin) && Number.isFinite(input.developmentN) && Number.isFinite(input.developmentSpf) && Number.isFinite(input.developmentAvg);
}
function evaluateQuality102CausalV4FeatureGate(input) {
  if (input.side !== -1 && input.side !== 1) return { accepted: false, reason: "INVALID_V4_FEATURE_SIDE" };
  if (!Number.isFinite(input.ret14) || !input.symbol.trim() || !input.variant.trim()) {
    return { accepted: false, reason: "INVALID_V4_FEATURE_INPUT" };
  }
  const alignedRet14 = input.side * input.ret14;
  if (input.family === "BRK") {
    const key = `${input.symbol.toUpperCase()}|${input.variant}`;
    const accepted = key === "FET|BRK24_H48_V1.2" && alignedRet14 >= 0.15 && alignedRet14 < 0.3 || key === "NEAR|BRK48_H48_V1.2" && alignedRet14 >= -0.05 && alignedRet14 < 0.02 || key === "RENDER|BRK168_H12_V1.2" && alignedRet14 >= 0.15 && alignedRet14 < 0.3;
    return { accepted, reason: accepted ? "V4_FEATURE_GATE_PASS" : "V4_BRK_VARIANT_WINDOW_REJECT" };
  }
  if (!v4FiniteDevelopment(input)) return { accepted: false, reason: "INVALID_V4_FEATURE_INPUT" };
  if (input.family === "MR") {
    if (!(alignedRet14 >= -0.15 && alignedRet14 < -0.08)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 20 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1.05 && input.margin < 1.7)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  if (input.family === "PB") {
    if (!(alignedRet14 >= -0.5 && alignedRet14 < 0.2)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 0 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1 && input.margin < 1.7)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  if (input.family === "REV") {
    if (!(alignedRet14 >= 0.1 && alignedRet14 < 0.3)) return { accepted: false, reason: "V4_RET14_WINDOW_REJECT" };
    if (input.developmentN < 0 || input.developmentSpf < 0 || input.developmentAvg < 0) return { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" };
    if (!(input.margin >= 1 && input.margin < 3)) return { accepted: false, reason: "V4_MARGIN_GATE_REJECT" };
    return { accepted: true, reason: "V4_FEATURE_GATE_PASS" };
  }
  return { accepted: false, reason: "UNKNOWN_V4_S34_FAMILY" };
}
var QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN = 0.24;
function evaluateQuality102CausalV4ImprovementGate(input) {
  if (input.side !== -1 && input.side !== 1) {
    return { accepted: false, reason: "INVALID_V4_IMPROVEMENT_SIDE" };
  }
  if (!Number.isFinite(input.ret14)) {
    return { accepted: false, reason: "INVALID_V4_IMPROVEMENT_RET14" };
  }
  if (input.family === "REV" && input.side === 1 && input.ret14 < QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN) {
    return { accepted: false, reason: "REV_LONG_RET14_BELOW_24PCT" };
  }
  return { accepted: true, reason: "V4_IMPROVEMENT_GATE_PASS" };
}
var LAYER_PRIORITY = Object.freeze({
  S1: 0,
  S2: 1,
  S3: 2,
  S4: 3
});

// config/disdexQuality102CausalV1Runtime.ts
var QUALITY102_CAUSAL_V1 = Object.freeze({
  strategyId: "QUALITY102_CAUSAL_V1",
  maximumGross: INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross,
  cryptoGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
  totalGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
  maximumPositions: INTEGRATED_PRODUCTION_RISK_POLICY.q102MaximumPositions,
  historicalSelectorParity: false,
  brkEnabled: false
});

// lib/disdex-quality102-causal-pipeline.ts
var QUALITY102_HOUR_MS = 36e5;
var QUALITY102_DAY_MS = 24 * QUALITY102_HOUR_MS;
var QUALITY102_HIGH_VOL_GRID = Object.freeze({
  longDrops: Object.freeze([0.08, 0.1, 0.12, 0.15]),
  longRsis: Object.freeze([30, 35, 40]),
  shortRallies: Object.freeze([0.05, 0.08, 0.1, 0.12]),
  shortRsis: Object.freeze([55, 60, 65]),
  hardStops: Object.freeze([0.1, 0.15])
});
var QUALITY102_EXPECTED_COUNTS = Object.freeze({
  raw: 151,
  highVolRaw: 30,
  s34Raw: 121,
  s34Rejected: 27,
  quality124: 124,
  oneSlotBlocked: 22,
  quality102: 102,
  layers: Object.freeze({ S1: 8, S2: 10, S3: 69, S4: 15 }),
  families: Object.freeze({ HIGH_VOL: 18, PB: 10, MR: 22, BRK: 28, REV: 24 }),
  exitReasons: Object.freeze({ time: 77, "72h_time": 13, stop: 7, trail_5pct_after_12pct: 5 })
});
var QUALITY102_RESEARCH_COSTS = Object.freeze({
  normal: Object.freeze({ perSide: 6e-4, fundingPerDay: 2e-4 }),
  stress: Object.freeze({ perSide: 1e-3, fundingPerDay: 5e-4 })
});
function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`QUALITY102_NONFINITE:${label}`);
  return value;
}
function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new Error(`QUALITY102_NONPOSITIVE:${label}`);
  return value;
}
function assertCandle(bar, index) {
  finite(bar.timestampMs, `candle[${index}].timestampMs`);
  positive(bar.open, `candle[${index}].open`);
  positive(bar.high, `candle[${index}].high`);
  positive(bar.low, `candle[${index}].low`);
  positive(bar.close, `candle[${index}].close`);
  finite(bar.quoteVolume, `candle[${index}].quoteVolume`);
  if (bar.quoteVolume < 0) throw new Error(`QUALITY102_NEGATIVE_VOLUME:${index}`);
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
    throw new Error(`QUALITY102_INVALID_OHLC:${index}`);
  }
}
function assertContiguousHourly(bars, start, end) {
  for (let index = start; index <= end; index += 1) {
    const bar = bars[index];
    if (!bar) throw new Error(`QUALITY102_MISSING_CANDLE:${index}`);
    assertCandle(bar, index);
    if (index > start && bar.timestampMs - bars[index - 1].timestampMs !== QUALITY102_HOUR_MS) {
      throw new Error(`QUALITY102_NONCONTIGUOUS_1H:${index}`);
    }
  }
}
function wilderRma(values, period) {
  if (values.length < period) throw new Error("QUALITY102_INSUFFICIENT_RMA_INPUT");
  let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) average = (average * (period - 1) + value) / period;
  return average;
}
function wilderRsi(closes, period = 14) {
  if (closes.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_RSI_INPUT");
  const gains = [];
  const losses = [];
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const averageGain = wilderRma(gains, period);
  const averageLoss = wilderRma(losses, period);
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
function wilderAtr(bars, period = 14) {
  if (bars.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_ATR_INPUT");
  const trueRanges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return wilderRma(trueRanges, period);
}
function median(values) {
  if (!values.length) throw new Error("QUALITY102_EMPTY_MEDIAN");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function monthStartUtc(timestampMs) {
  finite(timestampMs, "month.timestampMs");
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) throw new Error("QUALITY102_INVALID_TIMESTAMP");
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
function computeQuality102HighVolFeatures(bars, signalIndex) {
  if (!Number.isInteger(signalIndex) || signalIndex < 336 || signalIndex >= bars.length) {
    throw new Error("QUALITY102_SIGNAL_INDEX_REQUIRES_337_COMPLETED_BARS");
  }
  const start = signalIndex - 336;
  assertContiguousHourly(bars, start, signalIndex);
  const current = bars[signalIndex];
  const ret24 = current.close / bars[signalIndex - 24].close - 1;
  const ret14d = current.close / bars[signalIndex - 336].close - 1;
  const causalBars = bars.slice(start, signalIndex + 1);
  const atr14 = wilderAtr(causalBars, 14);
  const volumeRatioDenominator = median(bars.slice(signalIndex - 23, signalIndex + 1).map((bar) => bar.quoteVolume));
  const volumeRatio = volumeRatioDenominator > 0 ? current.quoteVolume / volumeRatioDenominator : current.quoteVolume > 0 ? Number.POSITIVE_INFINITY : 1;
  return {
    signalTs: current.timestampMs,
    ret24,
    ret14d,
    rsi14: wilderRsi(causalBars.map((bar) => bar.close), 14),
    atr14,
    atrPct: atr14 / current.close,
    volumeRatio,
    barUp: current.close > current.open,
    barDown: current.close < current.open
  };
}
function quality102HighVolMarketValid(features) {
  return Number.isFinite(features.ret14d) && features.atrPct >= 0.01 && features.volumeRatio >= 0.5;
}
function matchQuality102HighVolGrid(features) {
  if (!quality102HighVolMarketValid(features)) return [];
  const matches = [];
  if (features.ret14d >= 0 && features.barUp) {
    for (const threshold of QUALITY102_HIGH_VOL_GRID.longDrops) {
      for (const rsi of QUALITY102_HIGH_VOL_GRID.longRsis) {
        if (features.ret24 <= -threshold && features.rsi14 <= rsi) {
          for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: 1, threshold, rsi, hardStop });
        }
      }
    }
  } else if (features.ret14d < 0 && features.barDown) {
    for (const threshold of QUALITY102_HIGH_VOL_GRID.shortRallies) {
      for (const rsi of QUALITY102_HIGH_VOL_GRID.shortRsis) {
        if (features.ret24 >= threshold && features.rsi14 >= rsi) {
          for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: -1, threshold, rsi, hardStop });
        }
      }
    }
  }
  return matches;
}
function isGridValue(values, value) {
  return values.some((allowed) => allowed === value);
}
function assertHighVolRule(rule) {
  finite(rule.longDrop, "rule.longDrop");
  finite(rule.longRsi, "rule.longRsi");
  finite(rule.shortRally, "rule.shortRally");
  finite(rule.shortRsi, "rule.shortRsi");
  finite(rule.hardStop, "rule.hardStop");
  if (!isGridValue(QUALITY102_HIGH_VOL_GRID.longDrops, rule.longDrop) || !isGridValue(QUALITY102_HIGH_VOL_GRID.longRsis, rule.longRsi) || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRallies, rule.shortRally) || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRsis, rule.shortRsi) || !isGridValue(QUALITY102_HIGH_VOL_GRID.hardStops, rule.hardStop)) {
    throw new Error("QUALITY102_HIGH_VOL_RULE_OUTSIDE_GRID");
  }
}
function quality102HighVolRuleKey(rule) {
  assertHighVolRule(rule);
  return JSON.stringify({
    long_drop: rule.longDrop,
    long_rsi: rule.longRsi,
    short_rally: rule.shortRally,
    short_rsi: rule.shortRsi,
    hard_stop: rule.hardStop
  });
}
function selectQuality102HighVolMonthlyRule(input) {
  const monthStartTs = finite(input.monthStartTs, "monthStartTs");
  const monthStartDate = new Date(monthStartTs);
  if (monthStartTs <= 0 || monthStartTs % QUALITY102_HOUR_MS !== 0 || monthStartDate.getUTCDate() !== 1 || monthStartDate.getUTCHours() !== 0 || monthStartDate.getUTCMinutes() !== 0 || monthStartDate.getUTCSeconds() !== 0 || monthStartDate.getUTCMilliseconds() !== 0) {
    throw new Error("QUALITY102_INVALID_MONTH_START");
  }
  const expectedTrainingStart = monthStartTs - 180 * QUALITY102_DAY_MS;
  const expectedTrainingEnd = monthStartTs - QUALITY102_HOUR_MS;
  const eligible = [];
  const ineligible = [];
  for (const evaluation of input.evaluations) {
    let valid = true;
    try {
      assertHighVolRule(evaluation.rule);
      valid = Number.isInteger(evaluation.trades) && evaluation.trades >= 5 && Number.isInteger(evaluation.wins) && evaluation.wins >= 0 && evaluation.wins <= evaluation.trades && Number.isFinite(evaluation.totalReturn) && evaluation.totalReturn > 0 && !Number.isNaN(evaluation.profitFactor) && evaluation.profitFactor >= 1.15 && Number.isFinite(evaluation.expectancy) && evaluation.expectancy > 0 && Number.isFinite(evaluation.maxDrawdown) && evaluation.trainingStartTs === expectedTrainingStart && evaluation.trainingEndTs === expectedTrainingEnd && Number.isFinite(evaluation.availableAtTs) && evaluation.availableAtTs > 0 && evaluation.availableAtTs <= monthStartTs && evaluation.availableAtTs <= expectedTrainingEnd;
      if (!valid) throw new Error("ineligible");
    } catch {
      ineligible.push(evaluation);
      continue;
    }
    const winRate = evaluation.wins / evaluation.trades;
    if (winRate < 0.52) {
      ineligible.push(evaluation);
      continue;
    }
    const score = wilsonLowerBound(evaluation.wins, evaluation.trades, 1) + Math.min(evaluation.profitFactor, 3) * 0.03 + evaluation.expectancy * 2 - Math.max(0, -evaluation.maxDrawdown - 0.25);
    eligible.push({ ...evaluation, winRate, score, ruleKey: quality102HighVolRuleKey(evaluation.rule) });
  }
  eligible.sort((left, right) => right.score - left.score || left.ruleKey.localeCompare(right.ruleKey));
  return { selected: eligible[0], eligible, ineligible };
}
function wilsonLowerBound(wins, trades, z = 1) {
  if (!Number.isInteger(wins) || !Number.isInteger(trades) || trades <= 0 || wins < 0 || wins > trades || !(z > 0 && Number.isFinite(z))) {
    throw new Error("QUALITY102_INVALID_WILSON_INPUT");
  }
  const p = wins / trades;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trades;
  const center = p + zSquared / (2 * trades);
  const adjustment = z * Math.sqrt(p * (1 - p) / trades + zSquared / (4 * trades * trades));
  return (center - adjustment) / denominator;
}

// lib/disdex-quality102-causal-v1-signal.ts
var MINIMUM_HISTORY_HOURS = 181 * 24;
var FEATURE_WARMUP_HOURS = 336;
var MAXIMUM_HOLD_HOURS = 72;
var CORRELATION_HOURS = 30 * 24;
var MINIMUM_CORRELATION_HOURS = 10 * 24;
function ruleGrid(symbol) {
  const pengu = symbol === "PENGUUSDT";
  const longDrops = pengu ? QUALITY102_HIGH_VOL_GRID.longDrops : [0.08, 0.1, 0.12];
  const longRsis = pengu ? QUALITY102_HIGH_VOL_GRID.longRsis : [35, 40];
  const shortRallies = pengu ? QUALITY102_HIGH_VOL_GRID.shortRallies : [0.05, 0.08, 0.1];
  const shortRsis = pengu ? QUALITY102_HIGH_VOL_GRID.shortRsis : [60, 65];
  const rules = [];
  for (const longDrop of longDrops) for (const longRsi of longRsis) {
    for (const shortRally of shortRallies) for (const shortRsi of shortRsis) {
      for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) rules.push({ longDrop, longRsi, shortRally, shortRsi, hardStop });
    }
  }
  return rules;
}
function matchedSide(features, rule) {
  const match = matchQuality102HighVolGrid(features).find((candidate) => candidate.hardStop === rule.hardStop && (candidate.side === 1 ? candidate.threshold === rule.longDrop && candidate.rsi === rule.longRsi : candidate.threshold === rule.shortRally && candidate.rsi === rule.shortRsi));
  return match?.side;
}
function summarizeReturns(returns) {
  if (!returns.length) return { trades: 0, wins: 0, totalReturn: 0, winRate: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0 };
  let equity = 1;
  let peak;
  let maxDrawdown = 0;
  let gains = 0;
  let losses = 0;
  let wins = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = peak === void 0 ? equity : Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (value > 0) {
      wins += 1;
      gains += value;
    } else {
      losses += value;
    }
  }
  return {
    trades: returns.length,
    wins,
    totalReturn: equity - 1,
    winRate: wins / returns.length,
    profitFactor: losses < 0 ? gains / -losses : 999,
    expectancy: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    maxDrawdown
  };
}
function trainRule(rows, features, rule, firstSignalIndex, trainingEndIndex) {
  const returns = [];
  let signalIndex = firstSignalIndex;
  while (signalIndex < trainingEndIndex - MAXIMUM_HOLD_HOURS) {
    const side = matchedSide(features.get(signalIndex), rule);
    if (side === void 0) {
      signalIndex += 1;
      continue;
    }
    const entryIndex = signalIndex + 1;
    const entryPrice = rows[entryIndex].open;
    const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
    let exitIndex = signalIndex + MAXIMUM_HOLD_HOURS;
    let exitPrice = rows[exitIndex].close;
    for (let index = entryIndex; index <= exitIndex; index += 1) {
      if (side === 1 && rows[index].low <= stopPrice || side === -1 && rows[index].high >= stopPrice) {
        exitIndex = index;
        exitPrice = stopPrice;
        break;
      }
    }
    const holdHours = exitIndex - entryIndex + 1;
    const grossReturn = side * (exitPrice / entryPrice - 1);
    const costs = QUALITY102_RESEARCH_COSTS.normal;
    returns.push(grossReturn - 2 * costs.perSide - costs.fundingPerDay * holdHours / 24);
    signalIndex = exitIndex + 1;
  }
  return summarizeReturns(returns);
}
function monthlySelection(symbol, rows, dataCutoffTs) {
  const monthStartTs = monthStartUtc(dataCutoffTs);
  const trainingStartTs = monthStartTs - 180 * QUALITY102_DAY_MS;
  const trainingEndTs = monthStartTs - QUALITY102_HOUR_MS;
  const firstTs = rows[0].timestampMs;
  if (firstTs > trainingStartTs - FEATURE_WARMUP_HOURS * QUALITY102_HOUR_MS || rows.at(-1).timestampMs < trainingEndTs) return void 0;
  const firstSignalIndex = (trainingStartTs - firstTs) / QUALITY102_HOUR_MS;
  const trainingEndIndex = (trainingEndTs - firstTs) / QUALITY102_HOUR_MS;
  if (!Number.isInteger(firstSignalIndex) || !Number.isInteger(trainingEndIndex)) return void 0;
  const features = /* @__PURE__ */ new Map();
  for (let index = firstSignalIndex; index < trainingEndIndex - MAXIMUM_HOLD_HOURS; index += 1) {
    features.set(index, computeQuality102HighVolFeatures(rows, index));
  }
  const evaluations = ruleGrid(symbol).map((rule) => {
    const metrics = trainRule(rows, features, rule, firstSignalIndex, trainingEndIndex);
    return { rule, ...metrics, trainingStartTs, trainingEndTs, availableAtTs: trainingEndTs };
  });
  const selected = selectQuality102HighVolMonthlyRule({ monthStartTs, evaluations }).selected;
  if (!selected) return void 0;
  return {
    rule: selected.rule,
    metrics: {
      trades: selected.trades,
      wins: selected.wins,
      totalReturn: selected.totalReturn,
      winRate: selected.winRate,
      profitFactor: selected.profitFactor,
      expectancy: selected.expectancy,
      maxDrawdown: selected.maxDrawdown
    }
  };
}
function scannerHealthPass(metrics) {
  return metrics.winRate >= 0.58 && metrics.profitFactor >= 1.3 && metrics.expectancy > 0 && metrics.maxDrawdown >= -0.3 && metrics.trades >= 5;
}
function candidateFor(symbol, rows, dataCutoffTs) {
  const selection = monthlySelection(symbol, rows, dataCutoffTs);
  if (!selection || symbol !== "PENGUUSDT" && !scannerHealthPass(selection.metrics)) return { selection };
  const features = computeQuality102HighVolFeatures(rows, rows.length - 1);
  const side = matchedSide(features, selection.rule);
  if (side === void 0) return { selection };
  const metrics = selection.metrics;
  const score = 30 * metrics.winRate + 10 * Math.min(metrics.profitFactor, 3) + 200 * Math.max(-0.05, Math.min(0.1, metrics.expectancy)) + 60 * Math.min(Math.abs(features.ret24), 0.25) + 30 * Math.min(features.atrPct, 0.08) + 2 * Math.min(features.volumeRatio, 3) + (symbol === "PENGUUSDT" ? 3 : 0);
  return { selection, candidate: { id: `HIGH_VOL:${symbol}:${features.signalTs}`, symbol, side, score } };
}
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
function highVolProximity(features, rule, side) {
  const long = side === 1;
  const progress = {
    regime: long ? features.ret14d >= 0 ? 1 : 0 : features.ret14d < 0 ? 1 : 0,
    barDirection: long ? features.barUp ? 1 : 0 : features.barDown ? 1 : 0,
    ret24: long ? clamp01(-features.ret24 / rule.longDrop) : clamp01(features.ret24 / rule.shortRally),
    rsi14: long ? features.rsi14 <= rule.longRsi ? 1 : clamp01(rule.longRsi / Math.max(features.rsi14, 1e-9)) : features.rsi14 >= rule.shortRsi ? 1 : clamp01(features.rsi14 / rule.shortRsi),
    atrPct: clamp01(features.atrPct / 0.01),
    volumeRatio: clamp01(features.volumeRatio / 0.5)
  };
  const score = 100 * (progress.regime + progress.barDirection + progress.ret24 + progress.rsi14 + progress.atrPct + progress.volumeRatio) / 6;
  return { score, progress };
}
function diagnoseQuality102HighVolSymbol(symbolInput, rows, dataCutoffTs) {
  const symbol = symbolInput.trim().toUpperCase();
  const { selection, candidate } = candidateFor(symbol, rows, dataCutoffTs);
  if (!selection) {
    return {
      symbol,
      selectionAvailable: false,
      scannerHealthPass: false,
      marketValid: false,
      rawMatched: false,
      proximityScore: 0,
      rankingScore: 0,
      reason: "HIGH_VOL_MONTHLY_RULE_UNAVAILABLE"
    };
  }
  const features = computeQuality102HighVolFeatures(rows, rows.length - 1);
  const healthPass = symbol === "PENGUUSDT" || scannerHealthPass(selection.metrics);
  const marketValid = quality102HighVolMarketValid(features);
  const matched = matchedSide(features, selection.rule);
  const long = highVolProximity(features, selection.rule, 1);
  const short = highVolProximity(features, selection.rule, -1);
  const best = long.score >= short.score ? { side: 1, ...long } : { side: -1, ...short };
  const proximityScore = Math.round(best.score * 100) / 100;
  const rankingScore2 = matched !== void 0 && healthPass ? 100 : healthPass ? Math.round((40 + 0.4 * proximityScore) * 100) / 100 : Math.round((20 + 0.2 * proximityScore) * 100) / 100;
  return {
    symbol,
    selectionAvailable: true,
    scannerHealthPass: healthPass,
    marketValid,
    rawMatched: matched !== void 0,
    ...matched !== void 0 ? { matchedSide: matched } : {},
    proximitySide: best.side,
    proximityScore,
    rankingScore: rankingScore2,
    ...candidate ? { legacySelectorScore: candidate.score } : {},
    rule: selection.rule,
    metrics: selection.metrics,
    features,
    gateProgress: best.progress,
    reason: matched !== void 0 && healthPass ? "HIGH_VOL_RAW_SIGNAL_READY" : !healthPass ? "HIGH_VOL_SCANNER_HEALTH_BLOCKED" : !marketValid ? "HIGH_VOL_MARKET_VALIDITY_BLOCKED" : "HIGH_VOL_THRESHOLD_NOT_REACHED"
  };
}

// config/disdexQuality102CausalV4Model.ts
var QUALITY102_CAUSAL_V4_DEVELOPMENT_PERIOD = Object.freeze({
  startInclusive: "2025-03-01T00:00:00Z",
  endExclusive: "2025-08-01T00:00:00Z",
  source: "PRE_EVALUATION_DEVELOPMENT_ONLY"
});
var QUALITY102_CAUSAL_V4_S34_MODEL = Object.freeze([
  Object.freeze({ key: "AAVE|MR48_Z2.5_H24", symbol: "AAVEUSDT", variant: "MR48_Z2.5_H24", family: "MR", layer: "S3", developmentN: 10, developmentSpf: 1.52236777276818, developmentAvg: 0.0108654242977555 }),
  Object.freeze({ key: "APT|REV24_T0.05_H24", symbol: "APTUSDT", variant: "REV24_T0.05_H24", family: "REV", layer: "S3", developmentN: 44, developmentSpf: 1.27729468528803, developmentAvg: 0.00656674098033 }),
  Object.freeze({ key: "APT|REV6_T0.03_H24", symbol: "APTUSDT", variant: "REV6_T0.03_H24", family: "REV", layer: "S3", developmentN: 18, developmentSpf: 2.39382185041081, developmentAvg: 0.0215414819560662 }),
  Object.freeze({ key: "AVAX|MR24_Z1.5_H24", symbol: "AVAXUSDT", variant: "MR24_Z1.5_H24", family: "MR", layer: "S3", developmentN: 53, developmentSpf: 1.24626770590961, developmentAvg: 0.0057750426106673 }),
  Object.freeze({ key: "AVAX|PB168_0.1_P24_0.04_H24", symbol: "AVAXUSDT", variant: "PB168_0.1_P24_0.04_H24", family: "PB", layer: "S3", developmentN: 7, developmentSpf: 1.71016853501698, developmentAvg: 0.0110802317833757 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H12", symbol: "AVAXUSDT", variant: "REV12_T0.03_H12", family: "REV", layer: "S3", developmentN: 75, developmentSpf: 1.52026808715621, developmentAvg: 0.006927005619842 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H8", symbol: "AVAXUSDT", variant: "REV12_T0.03_H8", family: "REV", layer: "S3", developmentN: 78, developmentSpf: 1.40325068773588, developmentAvg: 0.0047583867652531 }),
  Object.freeze({ key: "AVAX|REV12_T0.08_H24", symbol: "AVAXUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 9, developmentSpf: 2.3806830797075, developmentAvg: 0.0219786966819735 }),
  Object.freeze({ key: "DOGE|BRK24_H48_V1.0", symbol: "DOGEUSDT", variant: "BRK24_H48_V1.0", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.28734054076723, developmentAvg: 0.0096629482231092 }),
  Object.freeze({ key: "DOGE|BRK72_H48_V0.8", symbol: "DOGEUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 29, developmentSpf: 1.35891257238384, developmentAvg: 0.0112041987595541 }),
  Object.freeze({ key: "DOGE|MR48_Z2.0_H12", symbol: "DOGEUSDT", variant: "MR48_Z2.0_H12", family: "MR", layer: "S4", developmentN: 35, developmentSpf: 1.47637548088035, developmentAvg: 0.0080984366274167 }),
  Object.freeze({ key: "DOGE|MR72_Z1.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z1.5_H12", family: "MR", layer: "S4", developmentN: 72, developmentSpf: 1.38502939392078, developmentAvg: 0.0061897682920218 }),
  Object.freeze({ key: "DOGE|MR72_Z2.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z2.5_H12", family: "MR", layer: "S4", developmentN: 11, developmentSpf: 1.43133377123862, developmentAvg: 0.0102975813022613 }),
  Object.freeze({ key: "DOT|BRK72_H48_V0.8", symbol: "DOTUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 33, developmentSpf: 1.24740411002169, developmentAvg: 0.0065267354063517 }),
  Object.freeze({ key: "FET|BRK24_H48_V1.2", symbol: "FETUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 39, developmentSpf: 1.32803399016521, developmentAvg: 0.0097905549346322 }),
  Object.freeze({ key: "FET|PB168_0.1_P24_0.02_H12", symbol: "FETUSDT", variant: "PB168_0.1_P24_0.02_H12", family: "PB", layer: "S3", developmentN: 26, developmentSpf: 2.00067621132769, developmentAvg: 0.0100534613762825 }),
  Object.freeze({ key: "FET|PB72_0.1_P12_0.04_H12", symbol: "FETUSDT", variant: "PB72_0.1_P12_0.04_H12", family: "PB", layer: "S3", developmentN: 13, developmentSpf: 1.81484714670338, developmentAvg: 0.0095011104136757 }),
  Object.freeze({ key: "FET|REV12_T0.05_H12", symbol: "FETUSDT", variant: "REV12_T0.05_H12", family: "REV", layer: "S3", developmentN: 50, developmentSpf: 1.58520129707493, developmentAvg: 0.0087653491849914 }),
  Object.freeze({ key: "FET|REV12_T0.08_H24", symbol: "FETUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 11, developmentSpf: 8.08070422039161, developmentAvg: 0.0413021804029054 }),
  Object.freeze({ key: "FET|REV24_T0.05_H8", symbol: "FETUSDT", variant: "REV24_T0.05_H8", family: "REV", layer: "S3", developmentN: 69, developmentSpf: 1.29882917503414, developmentAvg: 0.0043871257099106 }),
  Object.freeze({ key: "FET|REV24_T0.08_H8", symbol: "FETUSDT", variant: "REV24_T0.08_H8", family: "REV", layer: "S3", developmentN: 31, developmentSpf: 1.90794772499766, developmentAvg: 0.0096499259228725 }),
  Object.freeze({ key: "LDO|BRK24_H24_V1.0", symbol: "LDOUSDT", variant: "BRK24_H24_V1.0", family: "BRK", layer: "S3", developmentN: 57, developmentSpf: 1.31281148909032, developmentAvg: 0.0076779880422025 }),
  Object.freeze({ key: "LDO|BRK48_H24_V1.0", symbol: "LDOUSDT", variant: "BRK48_H24_V1.0", family: "BRK", layer: "S3", developmentN: 48, developmentSpf: 1.31622876544241, developmentAvg: 0.008453791923583 }),
  Object.freeze({ key: "NEAR|BRK168_H24_V1.2", symbol: "NEARUSDT", variant: "BRK168_H24_V1.2", family: "BRK", layer: "S3", developmentN: 27, developmentSpf: 1.48840221382932, developmentAvg: 0.0091330294375599 }),
  Object.freeze({ key: "NEAR|BRK48_H48_V1.2", symbol: "NEARUSDT", variant: "BRK48_H48_V1.2", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.31919794984148, developmentAvg: 0.0089832346064616 }),
  Object.freeze({ key: "RENDER|BRK168_H12_V1.2", symbol: "RENDERUSDT", variant: "BRK168_H12_V1.2", family: "BRK", layer: "S4", developmentN: 37, developmentSpf: 1.2461023118082, developmentAvg: 0.0043356885581458 }),
  Object.freeze({ key: "SOL|BRK24_H48_V1.2", symbol: "SOLUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 37, developmentSpf: 1.78857139913644, developmentAvg: 0.0179361486336277 }),
  Object.freeze({ key: "SOL|BRK72_H48_V1.2", symbol: "SOLUSDT", variant: "BRK72_H48_V1.2", family: "BRK", layer: "S3", developmentN: 25, developmentSpf: 1.75061992691195, developmentAvg: 0.0171229061115549 }),
  Object.freeze({ key: "UNI|MR24_Z2.0_H24", symbol: "UNIUSDT", variant: "MR24_Z2.0_H24", family: "MR", layer: "S4", developmentN: 19, developmentSpf: 1.82181594946119, developmentAvg: 0.0177824545392012 }),
  Object.freeze({ key: "UNI|MR48_Z1.5_H24", symbol: "UNIUSDT", variant: "MR48_Z1.5_H24", family: "MR", layer: "S4", developmentN: 63, developmentSpf: 1.46705889766814, developmentAvg: 0.0097478033268243 }),
  Object.freeze({ key: "UNI|MR72_Z1.5_H24", symbol: "UNIUSDT", variant: "MR72_Z1.5_H24", family: "MR", layer: "S4", developmentN: 56, developmentSpf: 1.26613814311217, developmentAvg: 0.006291723493164 })
]);
var QUALITY102_CAUSAL_V4_S34_KEYS = Object.freeze(QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.key));
var QUALITY102_CAUSAL_V4_CAPABILITIES = Object.freeze({
  selectorImplemented: true,
  derivedHighVolGeneratorImplemented: true,
  s34GeneratorImplemented: true,
  s34ModelKeyCount: QUALITY102_CAUSAL_V4_S34_MODEL.length,
  fixedHistoricalTradeTimestamps: false,
  noLookaheadByConstruction: true,
  historicalSelectorParity: false
});

// lib/disdex-quality102-causal-v4-s34.ts
var HOUR_MS = 36e5;
var RET14_HOURS = 336;
function finitePositive(value, field) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`QUALITY102_CAUSAL_V4_INVALID_${field}`);
  return value;
}
function sampleStdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
function median2(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function familyHardStop(family, holdHours) {
  if (family === "PB" || family === "MR") return holdHours === 12 ? 0.05 : 0.07;
  if (family === "REV") return holdHours === 8 || holdHours === 12 ? 0.045 : 0.06;
  return holdHours >= 48 ? 0.08 : 0.05;
}
function computeRet14(rows, entryOpen) {
  if (rows.length < RET14_HOURS) throw new Error("QUALITY102_CAUSAL_V4_RET14_HISTORY_REQUIRED");
  const prior = rows[rows.length - RET14_HOURS];
  return finitePositive(entryOpen.open, "ENTRY_OPEN") / finitePositive(prior.open, "RET14_PRIOR_OPEN") - 1;
}
function parsePb(variant) {
  const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])] : void 0;
}
function parseMr(variant) {
  const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function parseRev(variant) {
  const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function parseBrk(variant) {
  const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : void 0;
}
function detectPb(rows, variant) {
  const parsed = parsePb(variant);
  if (!parsed) return void 0;
  const [lookback, trendThreshold, pullback, pullThreshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t < Math.max(lookback, pullback)) return void 0;
  const longRet = rows[t].close / rows[t - lookback].close - 1;
  const pullRet = rows[t].close / rows[t - pullback].close - 1;
  const side = longRet >= trendThreshold && pullRet <= -pullThreshold ? 1 : longRet <= -trendThreshold && pullRet >= pullThreshold ? -1 : void 0;
  if (side === void 0) return void 0;
  return { side, strength: Math.abs(longRet) + Math.abs(pullRet), margin: Math.min(Math.abs(longRet) / trendThreshold, Math.abs(pullRet) / pullThreshold), holdHours };
}
function detectMr(rows, variant) {
  const parsed = parseMr(variant);
  if (!parsed) return void 0;
  const [lookback, zThreshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t - lookback + 1 < 0) return void 0;
  const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
  const stdev = sampleStdev(closes);
  if (!(stdev > 0)) return void 0;
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const z = (rows[t].close - mean) / stdev;
  const side = z >= zThreshold ? -1 : z <= -zThreshold ? 1 : void 0;
  return side === void 0 ? void 0 : { side, strength: Math.abs(z), margin: Math.abs(z) / zThreshold, holdHours };
}
function detectRev(rows, variant) {
  const parsed = parseRev(variant);
  if (!parsed) return void 0;
  const [lookback, threshold, holdHours] = parsed;
  const t = rows.length - 1;
  if (t < lookback) return void 0;
  const move = rows[t].close / rows[t - lookback].close - 1;
  const side = move >= threshold ? -1 : move <= -threshold ? 1 : void 0;
  return side === void 0 ? void 0 : { side, strength: Math.abs(move), margin: Math.abs(move) / threshold, holdHours };
}
function baseVolume(row) {
  const value = row.baseVolume;
  if (!Number.isFinite(value) || value < 0) throw new Error("QUALITY102_CAUSAL_V4_BRK_BASE_VOLUME_REQUIRED");
  return value;
}
function detectBrk(rows, variant) {
  const parsed = parseBrk(variant);
  if (!parsed) return void 0;
  const [lookback, holdHours, volumeThreshold] = parsed;
  const t = rows.length - 1;
  if (t < Math.max(lookback, 72)) return void 0;
  const close = rows[t].close;
  const prior = rows.slice(t - lookback, t);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const side = close > priorHigh ? 1 : close < priorLow ? -1 : void 0;
  if (side === void 0) return void 0;
  const medianVolume = median2(rows.slice(t - 72, t).map(baseVolume));
  const volumeRatio = medianVolume > 0 ? baseVolume(rows[t]) / medianVolume : 0;
  if (volumeRatio + 1e-12 < volumeThreshold) return void 0;
  const breakout = side === 1 ? close / priorHigh - 1 : priorLow / close - 1;
  const strength = Math.abs(close / rows[t - lookback].close - 1);
  const margin = Math.min(volumeRatio / volumeThreshold, 1 + Math.max(0, breakout) * 100);
  return { side, strength, margin, holdHours };
}
function detectFamily(rows, variant) {
  if (variant.startsWith("PB")) return detectPb(rows, variant);
  if (variant.startsWith("MR")) return detectMr(rows, variant);
  if (variant.startsWith("REV")) return detectRev(rows, variant);
  if (variant.startsWith("BRK")) return detectBrk(rows, variant);
  return void 0;
}
function detectQuality102CausalV4S34RawSignal(rows, entryOpen, variant) {
  if (!rows.length) throw new Error("QUALITY102_CAUSAL_V4_S34_HISTORY_REQUIRED");
  const expectedEntryTs = rows.at(-1).timestampMs + HOUR_MS;
  if (entryOpen.timestampMs !== expectedEntryTs) throw new Error("QUALITY102_CAUSAL_V4_ENTRY_OPEN_TIMESTAMP_MISMATCH");
  const signal = detectFamily(rows, variant);
  if (!signal) return void 0;
  const family = variant.startsWith("PB") ? "PB" : variant.startsWith("MR") ? "MR" : variant.startsWith("BRK") ? "BRK" : "REV";
  return {
    ...signal,
    hardStop: familyHardStop(family, signal.holdHours),
    ret14: computeRet14(rows, entryOpen)
  };
}

// lib/disdex-quality102-causal-v4-signal.ts
var LAYER_RANK = Object.freeze({ S3: 1, S4: 2 });
var FAMILY_RANK = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });

// lib/disdex-quality102-causal-v4-ranking.ts
function clamp012(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function sampleStdev2(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
function median3(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function ret14(rows, entryOpen) {
  if (rows.length < 336) return void 0;
  const prior = rows[rows.length - 336];
  return prior?.open > 0 && entryOpen.open > 0 ? entryOpen.open / prior.open - 1 : void 0;
}
function pbMetrics(rows, variant) {
  const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const trendThreshold = Number(match[2]);
  const pullback = Number(match[3]);
  const pullThreshold = Number(match[4]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, pullback)) return void 0;
  const longRet = rows[t].close / rows[t - lookback].close - 1;
  const pullRet = rows[t].close / rows[t - pullback].close - 1;
  const longProgress = Math.min(clamp012(longRet / trendThreshold), clamp012(-pullRet / pullThreshold));
  const shortProgress = Math.min(clamp012(-longRet / trendThreshold), clamp012(pullRet / pullThreshold));
  const side = longProgress >= shortProgress ? 1 : -1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      longRet: round(longRet),
      pullRet: round(pullRet),
      trendThreshold,
      pullThreshold,
      longProgress: round(longProgress, 4),
      shortProgress: round(shortProgress, 4)
    }
  };
}
function mrMetrics(rows, variant) {
  const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const zThreshold = Number(match[2]);
  const t = rows.length - 1;
  if (t - lookback + 1 < 0) return void 0;
  const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
  const stdev = sampleStdev2(closes);
  if (!(stdev > 0)) return void 0;
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const z = (rows[t].close - mean) / stdev;
  return {
    side: z >= 0 ? -1 : 1,
    proximity: clamp012(Math.abs(z) / zThreshold),
    metrics: { zScore: round(z, 4), zThreshold, mean: round(mean), stdev: round(stdev) }
  };
}
function revMetrics(rows, variant) {
  const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const threshold = Number(match[2]);
  const t = rows.length - 1;
  if (t < lookback) return void 0;
  const move = rows[t].close / rows[t - lookback].close - 1;
  return {
    side: move >= 0 ? -1 : 1,
    proximity: clamp012(Math.abs(move) / threshold),
    metrics: { move: round(move), threshold }
  };
}
function brkMetrics(rows, variant) {
  const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
  if (!match || !rows.length) return void 0;
  const lookback = Number(match[1]);
  const volumeThreshold = Number(match[3]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, 72)) return void 0;
  const current = rows[t];
  const prior = rows.slice(t - lookback, t);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const volumes = rows.slice(t - 72, t).map((row) => Number(row.baseVolume ?? 0));
  const medianVolume = median3(volumes);
  const currentVolume = Number(current.baseVolume ?? 0);
  const volumeRatio = medianVolume > 0 ? currentVolume / medianVolume : 0;
  const longPriceProgress = clamp012(current.close / priorHigh);
  const shortPriceProgress = clamp012(priorLow / current.close);
  const volumeProgress = clamp012(volumeRatio / volumeThreshold);
  const longProgress = Math.min(longPriceProgress, volumeProgress);
  const shortProgress = Math.min(shortPriceProgress, volumeProgress);
  const side = longProgress >= shortProgress ? 1 : -1;
  const breakoutDistance = side === 1 ? current.close / priorHigh - 1 : priorLow / current.close - 1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      close: round(current.close),
      priorHigh: round(priorHigh),
      priorLow: round(priorLow),
      breakoutDistance: round(breakoutDistance),
      volumeRatio: round(volumeRatio, 4),
      volumeThreshold,
      volumeProgress: round(volumeProgress, 4),
      longPriceProgress: round(longPriceProgress, 4),
      shortPriceProgress: round(shortPriceProgress, 4)
    }
  };
}
function proximityFor(rows, variant) {
  if (variant.startsWith("PB")) return pbMetrics(rows, variant);
  if (variant.startsWith("MR")) return mrMetrics(rows, variant);
  if (variant.startsWith("REV")) return revMetrics(rows, variant);
  if (variant.startsWith("BRK")) return brkMetrics(rows, variant);
  return void 0;
}
function rankingScore(input) {
  const proximityPct = Math.max(0, Math.min(100, input.proximity * 100));
  let score = 0.6 * proximityPct;
  let stage = "NO_RAW";
  if (input.raw) {
    score = 60 + 0.1 * proximityPct;
    stage = "RAW_REJECTED";
  }
  if (input.raw && input.historical) {
    score = 70 + 0.1 * proximityPct;
    stage = "QUALITY_PASS";
  }
  if (input.raw && input.historical && input.feature) {
    score = 80 + 0.1 * proximityPct;
    stage = "FEATURE_PASS";
  }
  if (input.raw && input.historical && input.feature && input.improvement) {
    score = 90 + 0.1 * proximityPct;
    stage = "IMPROVEMENT_PASS";
  }
  if (input.gridOpen && input.raw && input.historical && input.feature && input.improvement) {
    score = 100;
    stage = "SIGNAL_READY";
  } else if (!input.gridOpen && score >= 90) {
    score = 89;
    stage = "GRID_WAIT";
  }
  return { score: Math.round(score * 100) / 100, stage };
}
function diagnoseQuality102CausalV4S34Symbol(input) {
  const symbol = input.symbol.trim().toUpperCase();
  const gridOpen = new Date(input.entryOpen.timestampMs).getUTCHours() % 4 === 1;
  const models = QUALITY102_CAUSAL_V4_S34_MODEL.filter((row) => row.symbol === symbol);
  const observedRet14 = ret14(input.rows, input.entryOpen);
  return models.map((model) => {
    const proximity = proximityFor(input.rows, model.variant);
    let raw;
    let rawError;
    try {
      raw = detectQuality102CausalV4S34RawSignal(input.rows, input.entryOpen, model.variant);
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }
    const historical = raw ? evaluateS34QualityGate({
      family: model.family,
      variant: model.variant,
      side: raw.side,
      strength: raw.strength,
      ret14: raw.ret14
    }) : void 0;
    const feature = raw && historical?.accepted ? evaluateQuality102CausalV4FeatureGate({
      family: model.family,
      symbol: model.symbol.replace(/USDT$/, ""),
      variant: model.variant,
      side: raw.side,
      ret14: raw.ret14,
      margin: raw.margin,
      developmentN: model.developmentN,
      developmentSpf: model.developmentSpf,
      developmentAvg: model.developmentAvg
    }) : void 0;
    const improvement = raw && historical?.accepted && feature?.accepted ? evaluateQuality102CausalV4ImprovementGate({
      family: model.family,
      side: raw.side,
      ret14: raw.ret14
    }) : void 0;
    const scored = rankingScore({
      gridOpen,
      proximity: proximity?.proximity ?? 0,
      raw: Boolean(raw),
      historical: historical?.accepted === true,
      feature: feature?.accepted === true,
      improvement: improvement?.accepted === true
    });
    const gates = [
      {
        name: "S34_4H_GRID",
        pass: gridOpen,
        reason: gridOpen ? "UTC_HOUR_MOD4_EQ1" : "UTC_HOUR_MOD4_NOT1",
        value: new Date(input.entryOpen.timestampMs).getUTCHours(),
        threshold: "hour % 4 == 1"
      },
      {
        name: "RAW_DETECTOR",
        pass: Boolean(raw),
        reason: raw ? "RAW_SIGNAL_DETECTED" : rawError || "RAW_THRESHOLD_NOT_REACHED"
      }
    ];
    if (historical) gates.push({ name: "HISTORICAL_QUALITY", pass: historical.accepted, reason: historical.reason });
    if (feature) gates.push({ name: "V4_FEATURE", pass: feature.accepted, reason: feature.reason });
    if (improvement) {
      gates.push({
        name: "V4_IMPROVEMENT",
        pass: improvement.accepted,
        reason: improvement.reason,
        ...model.family === "REV" && raw?.side === 1 ? { value: round(raw.ret14), threshold: QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN } : {}
      });
    }
    const reason = scored.stage === "SIGNAL_READY" ? "S34_SIGNAL_READY" : scored.stage === "GRID_WAIT" ? "S34_GRID_WAIT" : rawError ? rawError : improvement && !improvement.accepted ? improvement.reason : feature && !feature.accepted ? feature.reason : historical && !historical.accepted ? historical.reason : "RAW_THRESHOLD_NOT_REACHED";
    return {
      key: model.key,
      symbol,
      family: model.family,
      layer: model.layer,
      variant: model.variant,
      gridOpen,
      rawDetected: Boolean(raw),
      ...raw ? { candidateSide: raw.side } : proximity ? { candidateSide: proximity.side } : {},
      ...proximity ? { proximitySide: proximity.side } : {},
      proximityScore: Math.round((proximity?.proximity ?? 0) * 1e4) / 100,
      rankingScore: scored.score,
      rankingStage: scored.stage,
      reason,
      metrics: {
        ...proximity?.metrics ?? {},
        ...observedRet14 !== void 0 ? { ret14: round(observedRet14) } : {},
        ...raw ? {
          strength: round(raw.strength),
          margin: round(raw.margin),
          hardStop: round(raw.hardStop),
          holdHours: raw.holdHours
        } : {},
        developmentN: model.developmentN,
        developmentSpf: round(model.developmentSpf),
        developmentAvg: round(model.developmentAvg)
      },
      gates
    };
  }).sort((left, right) => right.rankingScore - left.rankingScore || left.key.localeCompare(right.key));
}

// lib/disdex-quality102-causal-v4-observability.ts
var LAYER_RANK2 = Object.freeze({ S3: 1, S4: 2 });
var FAMILY_RANK2 = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });
function highVolVariantLabel(diagnostic) {
  const rule = diagnostic?.rule;
  if (!rule) return void 0;
  return `HV_LD${rule.longDrop}_LRSI${rule.longRsi}_SR${rule.shortRally}_SRSI${rule.shortRsi}_STOP${rule.hardStop}`;
}
function augmentQuality102DecisionSnapshotWithRanking(input) {
  const highVol = new Set(input.highVolSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const rankedItems = input.snapshot.items.map((item) => {
    const symbol = item.symbol.toUpperCase();
    try {
      const rows = input.history.candlesBySymbol[symbol];
      if (!rows?.length) throw new Error(`QUALITY102_OBSERVER_HISTORY_MISSING:${symbol}`);
      const entryOpen = input.history.entryOpenBySymbol?.[symbol];
      const dataCutoffTs = rows.at(-1).timestampMs;
      const highVolDiagnostic = highVol.has(symbol) ? diagnoseQuality102HighVolSymbol(symbol, rows, dataCutoffTs) : void 0;
      const s34Diagnostics = entryOpen ? diagnoseQuality102CausalV4S34Symbol({ symbol, rows, entryOpen }) : [];
      const bestS34 = s34Diagnostics[0];
      const highVolScore = highVolDiagnostic?.rankingScore ?? -1;
      const s34Score = bestS34?.rankingScore ?? -1;
      const naturalEligible = item.eligible === true;
      const rankingFamily = naturalEligible && item.family ? item.family : highVolScore >= s34Score && highVolDiagnostic ? "HIGH_VOL" : bestS34?.family;
      const rankingLayer = naturalEligible && item.layer ? item.layer : rankingFamily === "HIGH_VOL" ? "S1" : bestS34?.layer;
      const rankingVariant = naturalEligible && item.variant ? item.variant : rankingFamily === "HIGH_VOL" ? highVolVariantLabel(highVolDiagnostic) : bestS34?.variant;
      const rankingScore2 = naturalEligible ? 100 : Math.max(0, highVolScore, s34Score);
      const rankingStage = naturalEligible ? "SIGNAL_READY" : rankingFamily === "HIGH_VOL" ? highVolDiagnostic?.rawMatched ? "HIGH_VOL_RAW_READY" : "HIGH_VOL_APPROACH" : bestS34?.rankingStage || "NO_MODEL";
      const rankingReason = naturalEligible ? item.reason : rankingFamily === "HIGH_VOL" ? highVolDiagnostic?.reason || item.reason : bestS34?.reason || item.reason;
      return {
        ...item,
        rankingScore: rankingScore2,
        ...rankingFamily ? { rankingFamily } : {},
        ...rankingLayer ? { rankingLayer } : {},
        ...rankingVariant ? { rankingVariant } : {},
        rankingStage,
        rankingReason,
        diagnostics: {
          ...highVolDiagnostic ? { highVol: highVolDiagnostic } : {},
          ...s34Diagnostics.length ? { s34: s34Diagnostics } : {}
        }
      };
    } catch (error) {
      return {
        ...item,
        rankingScore: 0,
        rankingStage: "OBSERVER_ERROR",
        rankingReason: error instanceof Error ? error.message : String(error)
      };
    }
  });
  const rankBySymbol = new Map(
    [...rankedItems].sort((left, right) => (right.rankingScore ?? 0) - (left.rankingScore ?? 0) || left.symbol.localeCompare(right.symbol)).map((item, index) => [item.symbol, index + 1])
  );
  return {
    ...input.snapshot,
    schemaVersion: 2,
    rankingModelVersion: "Q102_PROXIMITY_V1",
    rankingCapturedAt: input.rankingCapturedAt || (/* @__PURE__ */ new Date()).toISOString(),
    ...input.observerCommitSha ? { observerCommitSha: input.observerCommitSha } : {},
    items: rankedItems.map((item) => ({ ...item, rankingRank: rankBySymbol.get(item.symbol) }))
  };
}

// lib/disdex-quality102-ranking-history.ts
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var PREFIX = "decision-ranking-history-";
var SUFFIX = ".jsonl";
var DEFAULT_RETENTION_DAYS = 90;
var DAY_MS = 864e5;
function historyFileName(referenceTs) {
  const day = new Date(referenceTs).toISOString().slice(0, 10);
  return `${PREFIX}${day}${SUFFIX}`;
}
function lastReferenceTs(text) {
  const line = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return void 0;
  try {
    const parsed = JSON.parse(line);
    const value = Number(parsed.referenceTs);
    return Number.isFinite(value) && value > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
async function pruneOldRankingHistory(stateRoot, now, retentionDays) {
  const cutoff = now - retentionDays * DAY_MS;
  const names = await (0, import_promises2.readdir)(stateRoot);
  await Promise.all(names.map(async (name) => {
    const match = /^decision-ranking-history-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match) return;
    const fileDay = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isFinite(fileDay) && fileDay < cutoff) {
      await (0, import_promises2.unlink)((0, import_node_path2.resolve)(stateRoot, name)).catch(() => void 0);
    }
  }));
}
async function persistQuality102RankingHistory(input) {
  const referenceTs = Number(input.snapshot.referenceTs);
  if (!Number.isFinite(referenceTs) || referenceTs <= 0) throw new Error("Q102_RANKING_HISTORY_REFERENCE_TS_INVALID");
  if (input.snapshot.schemaVersion !== 2 || input.snapshot.rankingModelVersion !== "Q102_PROXIMITY_V1") {
    throw new Error("Q102_RANKING_HISTORY_SCHEMA_UNSUPPORTED");
  }
  const path = (0, import_node_path2.resolve)(input.stateRoot, historyFileName(referenceTs));
  let existing = "";
  try {
    existing = await (0, import_promises2.readFile)(path, "utf8");
  } catch (error) {
    const code = error.code;
    if (code !== "ENOENT") throw error;
  }
  if (lastReferenceTs(existing) === referenceTs) return { appended: false, path };
  await (0, import_promises2.appendFile)(path, JSON.stringify(input.snapshot) + "\n", { encoding: "utf8", mode: 384 });
  await pruneOldRankingHistory(input.stateRoot, Date.now(), input.retentionDays ?? DEFAULT_RETENTION_DAYS);
  return { appended: true, path };
}

// scripts/disdex-quality102-ranking-observer.ts
var DEFAULT_STATE_ROOT = "/var/lib/disdex/quality102-causal-v1";
var SHA_PATTERN = /^[0-9a-f]{40}$/i;
function requiredHighVolSymbols(value) {
  const values = String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(values)].sort();
  if (!unique.length) throw new Error("Q102_RANKING_OBSERVER_HIGH_VOL_SYMBOLS_REQUIRED");
  return unique;
}
function finitePositive2(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Q102_RANKING_OBSERVER_${field}_INVALID`);
  return number;
}
async function loadBaseSnapshot(path) {
  const parsed = JSON.parse(await (0, import_promises3.readFile)(path, "utf8"));
  if (parsed.strategyId !== "QUALITY102_CAUSAL_V1") throw new Error("Q102_RANKING_OBSERVER_STRATEGY_MISMATCH");
  if (parsed.selectorMode !== "CAUSAL_V4") throw new Error("Q102_RANKING_OBSERVER_SELECTOR_MISMATCH");
  if (!SHA_PATTERN.test(String(parsed.runtimeCommitSha || ""))) throw new Error("Q102_RANKING_OBSERVER_RUNTIME_SHA_INVALID");
  if (!Number.isFinite(Number(parsed.referenceTs)) || Number(parsed.referenceTs) <= 0) throw new Error("Q102_RANKING_OBSERVER_REFERENCE_TS_INVALID");
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error("Q102_RANKING_OBSERVER_ITEMS_MISSING");
  return parsed;
}
async function loadClosedHistory(path) {
  const parsed = JSON.parse(await (0, import_promises3.readFile)(path, "utf8"));
  if (!parsed.candlesBySymbol || typeof parsed.candlesBySymbol !== "object") {
    throw new Error("Q102_RANKING_OBSERVER_HISTORY_MISSING");
  }
  return { candlesBySymbol: parsed.candlesBySymbol };
}
async function loadEntryOpen(client, symbol, referenceTs) {
  const endTime = Math.max(referenceTs + 1, Date.now());
  const rows = await client.getKlines(symbol, "1h", 2, { startTime: referenceTs, endTime });
  const row = rows.find((candidate) => Number(candidate[0]) === referenceTs);
  if (!row) throw new Error(`Q102_RANKING_OBSERVER_ENTRY_OPEN_MISSING:${symbol}`);
  return { timestampMs: referenceTs, open: finitePositive2(row[1], `ENTRY_OPEN_${symbol}`) };
}
async function main() {
  const stateRoot = (0, import_node_path3.resolve)(process.env.QUALITY102_CAUSAL_V1_STATE_DIR || DEFAULT_STATE_ROOT);
  const baseSnapshotPath = (0, import_node_path3.resolve)(process.env.QUALITY102_DECISION_SNAPSHOT_PATH || (0, import_node_path3.resolve)(stateRoot, "decision-snapshot.json"));
  const historyPath = (0, import_node_path3.resolve)(process.env.QUALITY102_CAUSAL_V1_HISTORY_CACHE_PATH || (0, import_node_path3.resolve)(stateRoot, "market-history.json"));
  const outputPath = (0, import_node_path3.resolve)(process.env.QUALITY102_RANKING_SNAPSHOT_PATH || (0, import_node_path3.resolve)(stateRoot, "decision-ranking-snapshot.json"));
  const observerCommitSha = String(process.env.DISDEX_OBSERVER_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || "").trim();
  if (!SHA_PATTERN.test(observerCommitSha)) throw new Error("Q102_RANKING_OBSERVER_COMMIT_SHA_REQUIRED");
  const highVolSymbols = requiredHighVolSymbols(process.env.QUALITY102_CAUSAL_V1_SYMBOLS);
  const baseSnapshot = await loadBaseSnapshot(baseSnapshotPath);
  const history = await loadClosedHistory(historyPath);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_BASE_URL,
    requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS || 1e4),
    readOnlyRateLimitMaxRetries: Number(process.env.ASTER_READONLY_RATE_LIMIT_MAX_RETRIES || 3)
  });
  const symbols = [...new Set(baseSnapshot.items.map((item) => item.symbol.toUpperCase()))].sort();
  const entryOpenBySymbol = {};
  for (const symbol of symbols) {
    entryOpenBySymbol[symbol] = await loadEntryOpen(client, symbol, Number(baseSnapshot.referenceTs));
  }
  const ranked = augmentQuality102DecisionSnapshotWithRanking({
    snapshot: baseSnapshot,
    history: {
      candlesBySymbol: history.candlesBySymbol,
      entryOpenBySymbol
    },
    highVolSymbols,
    observerCommitSha,
    rankingCapturedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await (0, import_promises3.writeFile)(temporary, JSON.stringify(ranked, null, 2) + "\n", { encoding: "utf8", mode: 384 });
  await (0, import_promises3.rename)(temporary, outputPath);
  await persistQuality102RankingHistory({ stateRoot, snapshot: ranked });
  console.log(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_OK",
    readOnly: true,
    tradingMutation: 0,
    runtimeCommitSha: ranked.runtimeCommitSha,
    observerCommitSha: ranked.observerCommitSha,
    referenceTs: ranked.referenceTs,
    rankingCapturedAt: ranked.rankingCapturedAt,
    outputPath,
    items: ranked.items.length,
    top: [...ranked.items].sort((left, right) => (left.rankingRank ?? 999) - (right.rankingRank ?? 999)).slice(0, 5).map((item) => ({
      rank: item.rankingRank,
      symbol: item.symbol,
      score: item.rankingScore,
      family: item.rankingFamily,
      variant: item.rankingVariant,
      stage: item.rankingStage
    }))
  }));
}
main().catch((error) => {
  console.error(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_FAILED",
    readOnly: true,
    tradingMutation: 0,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/utils.js:
@noble/curves/esm/abstract/modular.js:
@noble/curves/esm/abstract/curve.js:
@noble/curves/esm/abstract/weierstrass.js:
@noble/curves/esm/_shortw_utils.js:
@noble/curves/esm/secp256k1.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
