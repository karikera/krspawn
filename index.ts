
import path = require('path');
import fs = require('fs');
import os = require('os');
import child_process = require('child_process');
import iconv = require('iconv-lite');

let charset = 'utf8';
const CPMAP = new Map([
    ['949','CP949'],
    ['932','CP932'],
    ['936','CP936'],
    ['949','CP949'],
    ['950','CP950']
]);

const isWindows = os.platform().startsWith('win32');
let spawned:child_process.ChildProcessWithoutNullStreams;

function readFile(path:string):Promise<string>
{
    return new Promise((resolve, reject)=>{
        fs.readFile(path, 'utf8', (err, data)=>{
            if (err) reject(err);
            else resolve(data);
        });
    });
}

function writeFile(path:string, content:string):Promise<void>
{
    return new Promise((resolve, reject)=>{
        fs.writeFile(path, content, 'utf8', (err)=>{
            if (err) reject(err);
            else resolve();
        });
    });
}

function exec(cmd:string):Promise<string>
{
    return new Promise((resolve, reject)=>{
        child_process.exec(cmd, (error, stdout, stderr)=>{
            if (error)
            {
                reject(error);
            }
            else
            {
                resolve(stdout);
            }
        });
    });
}

type Compare = (x:string, r:string[])=>unknown;
function makeCompare(line:string):Compare
{
    let nextIsOperator = false;
    let i = 0;
    const n = line.length;
    let parentheses = 0;
    while (i !== n)
    {
        const chr = line.charAt(i++);
        if (chr === ' ') continue;
        if (nextIsOperator)
        {
            if (chr === '+')
            {
                if (line.charAt(i) === '+')
                {
                    throw Error('Denied operator: ++');
                }
                nextIsOperator = false;
            }
            else if (chr === '-')
            {
                if (line.charAt(i) === '-')
                {
                    throw Error('Denied operator: --');
                }
                nextIsOperator = false;
            }
            else if (chr === '*')
            {
                if (line.charAt(i) === '*')
                {
                    i++;
                }
                nextIsOperator = false;
            }
            else if (chr === '/')
            {
                nextIsOperator = false;
            }
            else if (chr === '%')
            {
                nextIsOperator = false;
            }
            else if (chr === '=')
            {
                const nextchr = line.charAt(i++);
                if (nextchr !== '=')
                {
                    throw Error('Unexpected character: '+nextchr);
                }
                nextIsOperator = false;
            }
            else if (chr === '<')
            {
                const nextchr = line.charAt(i++);
                if (nextchr !== '=')
                {
                    throw Error('Unexpected character: '+nextchr);
                }
                nextIsOperator = false;
            }
            else if (chr === '>')
            {
                const nextchr = line.charAt(i++);
                if (nextchr !== '=')
                {
                    throw Error('Unexpected character: '+nextchr);
                }
                nextIsOperator = false;
            }
            else if (chr === ')')
            {
                parentheses--;
                if (parentheses < 0)
                {
                    throw Error('Unmatch parentheses');
                }
            }
            else
            {
                throw Error('Unexpected character: '+chr);
            }
        }
        else
        {
            if (chr === 'x')
            {
                nextIsOperator = true;
            }
            else if (chr === 't')
            {
                if (line.substr(i, 3) !== 'rue')
                {
                    throw Error('t must be true');
                }
                i += 3;
                nextIsOperator = true;
            }
            else if (chr === 'f')
            {
                if (line.substr(i, 4) !== 'alse')
                {
                    throw Error('f must be false');
                }
                i += 4;
                nextIsOperator = true;
            }
            else if (chr === '$')
            {
                const numchr = line.charCodeAt(i++);
                if (0x30 > numchr || numchr > 0x39)
                {
                    throw Error(`Unexpected character: ${String.fromCharCode(numchr)}`);
                }
                nextIsOperator = true;
            }
            else if (chr === '(')
            {
                parentheses++;
            }
            else if (chr === '-')
            {
                if (line.charAt(i) === '-')
                {
                    throw Error('Denied operator: --');
                }
            }
            else if (chr === '+')
            {
                if (line.charAt(i) === '+')
                {
                    throw Error('Denied operator: ++');
                }
            }
            else
            {
                let chrcode = chr.charCodeAt(0);
                if (0x30 <= chrcode && chrcode <= 0x39)
                {
                    do
                    {
                        chrcode = line.charCodeAt(i++);
                    }
                    while (0x30 <= chrcode && chrcode <= 0x39);
                    nextIsOperator = true;
                }
                else
                {
                    throw Error('Unexpected character: '+chr);
                }
            }
        }
    }
    if (!nextIsOperator) throw Error('Ends with operator');

    const func = new Function('x', 'r', 'return '+line.replace(/\$([0-9])/g, 'r[$1]'));
    return <Compare> func;
}

class Item
{
    constructor(
        public readonly compare:Compare, 
        public readonly command:string,
        public readonly xuid:string)
    {
    }
}

class Capture
{
    private readonly regexp:RegExp;
    private readonly items:Item[] = [];
    
    constructor(line:string)
    {
        if (line.startsWith('/'))
        {
            const endidx = line.lastIndexOf('/');
            this.regexp = new RegExp(line.substring(1, endidx), line.substr(endidx+1));
        }
        else
        {
            this.regexp = new RegExp(line);
        }
    }

    testAndRun(text:string):void
    {
        const arr = this.regexp.exec(text);
        if (arr)
        {
            for (const item of this.items)
            {
                if (item.compare(item.xuid, arr))
                {
                    const command = item.command.replace(/\$([0-9])/g, (match,v)=>v === '$' ? '$' : (arr[v] || ''))+'\n';
                    spawned.stdin.write(iconv.encode(command, charset));
                }
            }
        }
    }

    addItem(compare:Compare, command:string, xuid:string):void
    {
        this.items.push(new Item(compare, command, xuid));
    }
}

class LineDetector
{
    private buffer:string = '';
    constructor(private readonly callback:(line:string)=>void)
    {
    }

    add(text:string):void
    {
        for (;;)
        {
            let cmdend = text.indexOf('\n');
            if (cmdend !== -1)
            {
                const next = cmdend+1;
                if (text.charAt(cmdend-1) === '\r') cmdend--;
                this.buffer += text.substr(0, cmdend);
                this.callback(this.buffer);
                text = text.substr(next);
                this.buffer = '';
            }
            else
            {
                this.buffer += text;
                break;
            }
        }
    }
}

const captures:Capture[] = [];

async function loadTriggers():Promise<void>
{
    captures.length = 0;

    const fileName = 'triggers.txt';
    let compare:Compare = ()=>true;
    let command:string = '';
    let capture:Capture|undefined;

    let triggers_txt:string;
    try
    {
        triggers_txt = await readFile(fileName);
    }
    catch (err)
    {
        triggers_txt = await readFile(path.resolve(__dirname, fileName));
        await writeFile(fileName, triggers_txt);
    }
    let lineNumber = 0;
    for (let line of triggers_txt.split('\n'))
    {
        lineNumber++;
        const comment = line.indexOf('//');
        line = comment !== -1 ? line.substr(0, comment) : line;
        line = line.trim();
        if (line === '') continue;
        
        const labelSplit = line.indexOf(':');
        try
        {
            if (labelSplit !== -1)
            {
                const label = line.substr(0, labelSplit).trim();
                const value = line.substr(labelSplit+1).trim();
                switch(label)
                {
                case 'capture':
                    capture = new Capture(value);
                    captures.push(capture);
                    break;
                case 'compare':
                    compare = makeCompare(value);
                    break;
                case 'command':
                    command = value;
                    break;
                default:
                    throw Error('Unknown label ignored: '+label);
                }
            }
            else
            {
                if (capture)
                {
                    capture.addItem(compare, command, line);
                }
            }
        }
        catch (err)
        {
            console.error(`${fileName}(${lineNumber}): ${err.message}`);
        }
    }
}

(async()=>{

    {
        const runargs = process.argv.slice(2);
        let runexec = './bedrock_server';
        if (runargs.length !== 0)
        {
            runexec = runargs.shift()!;
        }
        if (isWindows)
        {
            const cp = await exec('chcp');
            const s = cp.indexOf(':') + 1; 
            const e = cp.indexOf('\n', s)-1;
            const codepage = cp.substring(s, e).trim();
            charset = CPMAP.get(codepage) || 'utf8';
            spawned = child_process.spawn('cmd', ['/s', '/c', runexec].concat(runargs));
        }
        else
        {
            spawned = child_process.spawn(runexec, runargs);
        }
        await loadTriggers();
        if (runexec === 'init') return;
    }


    const stdin = new LineDetector(command=>{
        if (command === 'update-triggers')
        {
            loadTriggers();
        }  
        else
        {
            spawned.stdin.write(iconv.encode(command+'\n', charset));
        }
    });
    const stdout = new LineDetector(out=>{
        for (const capture of captures)
        {
            capture.testAndRun(out);
        }
    });
    function onstdin(chunk:Buffer):void
    {
        stdin.add(chunk.toString('utf8'));
    }
    process.stdin.on('error', ()=>{});
    process.stdin.on('data', onstdin);
    spawned.on('close', ()=>{
        process.stdin.removeListener('data', onstdin);
        process.stdin.end();
    });
    spawned.stdout.on('data', chunk=>{
        const text = iconv.decode(chunk, charset);
        stdout.add(text);
        process.stdout.write(text);
    });
    spawned.stderr.on('data', chunk=>{
        const text = iconv.decode(chunk, charset);
        stdout.add(text);
        process.stderr.write(text);
    });

})().catch(err=>console.error(err));