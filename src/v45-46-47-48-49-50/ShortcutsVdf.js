// Reader and writer for Steam's binary VDF format, used by shortcuts.vdf.
// A map is stored as an ordered array of [key, node] pairs so that a file
// read and written back keeps its original layout.

const TYPE_MAP = 0x00;
const TYPE_STRING = 0x01;
const TYPE_INT32 = 0x02;
const TYPE_FLOAT32 = 0x03;
const TYPE_UINT64 = 0x07;
const TYPE_END = 0x08;
const TYPE_INT64 = 0x0a;

// Sizes of the fixed-width values we keep as raw bytes.
const RAW_SIZES = {
    [TYPE_FLOAT32]: 4,
    [TYPE_UINT64]: 8,
    [TYPE_INT64]: 8,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const map = (entries = []) => ({type: TYPE_MAP, value: entries});
export const string = value => ({type: TYPE_STRING, value});
export const int32 = value => ({type: TYPE_INT32, value});

class Reader {
    constructor(bytes) {
        this._bytes = bytes;
        this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this._pos = 0;
    }

    get done() {
        return this._pos >= this._bytes.length;
    }

    byte() {
        if (this.done)
            throw new Error('Unexpected end of shortcuts.vdf');
        return this._bytes[this._pos++];
    }

    cstring() {
        const end = this._bytes.indexOf(0, this._pos);
        if (end < 0)
            throw new Error('Unterminated string in shortcuts.vdf');
        const value = decoder.decode(this._bytes.subarray(this._pos, end));
        this._pos = end + 1;
        return value;
    }

    int32() {
        const value = this._view.getInt32(this._pos, true);
        this._pos += 4;
        return value;
    }

    raw(size) {
        const value = this._bytes.slice(this._pos, this._pos + size);
        this._pos += size;
        return value;
    }

    map() {
        const entries = [];
        while (!this.done) {
            const type = this.byte();
            if (type === TYPE_END)
                break;

            const key = this.cstring();
            if (type === TYPE_MAP)
                entries.push([key, map(this.map())]);
            else if (type === TYPE_STRING)
                entries.push([key, string(this.cstring())]);
            else if (type === TYPE_INT32)
                entries.push([key, int32(this.int32())]);
            else if (type in RAW_SIZES)
                entries.push([key, {type, value: this.raw(RAW_SIZES[type])}]);
            else
                throw new Error(`Unknown VDF value type 0x${type.toString(16)}`);
        }
        return entries;
    }
}

export function parse(bytes) {
    return map(new Reader(bytes).map());
}

export function serialize(root) {
    const chunks = [];
    const pushString = value => {
        chunks.push(encoder.encode(value), Uint8Array.of(0));
    };
    const writeMap = entries => {
        for (const [key, node] of entries) {
            chunks.push(Uint8Array.of(node.type));
            pushString(key);
            if (node.type === TYPE_MAP) {
                writeMap(node.value);
            } else if (node.type === TYPE_STRING) {
                pushString(node.value);
            } else if (node.type === TYPE_INT32) {
                const value = new Uint8Array(4);
                new DataView(value.buffer).setInt32(0, node.value, true);
                chunks.push(value);
            } else {
                chunks.push(node.value);
            }
        }
        chunks.push(Uint8Array.of(TYPE_END));
    };
    writeMap(root.value);

    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

// Returns the node stored under key in a map node, or undefined.
export function get(node, key) {
    if (node?.type !== TYPE_MAP)
        return undefined;
    // Steam itself is inconsistent about the case of some keys (appid/AppName).
    const lowerKey = key.toLowerCase();
    return node.value.find(([name]) => name.toLowerCase() === lowerKey)?.[1];
}
