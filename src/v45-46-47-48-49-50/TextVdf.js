// Reader and writer for Steam's text KeyValues format, used by config.vdf.
// A map is an ordered array of [key, value] pairs, where value is either a
// string or another map, so a file read and written back keeps its order.

const ESCAPES = {n: '\n', t: '\t', '\\': '\\', '"': '"'};

function tokenize(text) {
    const tokens = [];
    let pos = 0;
    while (pos < text.length) {
        const char = text[pos];
        if (/\s/.test(char)) {
            pos++;
        } else if (text.startsWith('//', pos)) {
            const end = text.indexOf('\n', pos);
            pos = end < 0 ? text.length : end;
        } else if (char === '{' || char === '}') {
            tokens.push(char);
            pos++;
        } else if (char === '[') {
            // Platform conditionals such as [$WIN32] apply to the previous
            // token; Steam does not write them in config.vdf.
            const end = text.indexOf(']', pos);
            pos = end < 0 ? text.length : end + 1;
        } else if (char === '"') {
            let value = '';
            pos++;
            while (pos < text.length && text[pos] !== '"') {
                if (text[pos] === '\\' && pos + 1 < text.length) {
                    value += ESCAPES[text[pos + 1]] ?? text[pos + 1];
                    pos += 2;
                } else {
                    value += text[pos++];
                }
            }
            tokens.push({value});
            pos++;
        } else {
            // Unquoted tokens end at whitespace or a brace.
            const match = /^[^\s{}"]+/.exec(text.slice(pos));
            tokens.push({value: match[0]});
            pos += match[0].length;
        }
    }
    return tokens;
}

export function parse(text) {
    const tokens = tokenize(text);
    let pos = 0;
    const readMap = () => {
        const entries = [];
        while (pos < tokens.length && tokens[pos] !== '}') {
            const key = tokens[pos++];
            if (typeof key !== 'object')
                throw new Error('Expected a key in config.vdf');
            const value = tokens[pos++];
            if (value === '{') {
                entries.push([key.value, readMap()]);
                pos++; // Closing brace
            } else if (typeof value === 'object') {
                entries.push([key.value, value.value]);
            } else {
                throw new Error(`Expected a value for "${key.value}" in config.vdf`);
            }
        }
        return entries;
    };
    return readMap();
}

const quote = value => `"${value.replace(/[\\"]/g, '\\$&')}"`;

export function serialize(entries, depth = 0) {
    const indent = '\t'.repeat(depth);
    return entries.map(([key, value]) => typeof value === 'string'
        ? `${indent}${quote(key)}\t\t${quote(value)}\n`
        : `${indent}${quote(key)}\n${indent}{\n${serialize(value, depth + 1)}${indent}}\n`
    ).join('');
}

// Returns the value under key, ignoring case like Steam does.
export function get(entries, key) {
    const lowerKey = key.toLowerCase();
    return entries?.find(([name]) => name.toLowerCase() === lowerKey)?.[1];
}

// Returns the map at the given path, creating the missing maps.
export function ensureMap(entries, path) {
    for (const key of path) {
        let child = get(entries, key);
        if (!Array.isArray(child)) {
            child = [];
            const index = entries.findIndex(([name]) => name.toLowerCase() === key.toLowerCase());
            if (index >= 0)
                entries[index][1] = child;
            else
                entries.push([key, child]);
        }
        entries = child;
    }
    return entries;
}
