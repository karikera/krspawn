#!/usr/bin/env node

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
                let nextchr = line.charAt(i++);
                if (nextchr !== '=')
                {
                    throw Error('Unexpected character: '+nextchr);
                }
                nextchr = line.charAt(i);
                if (nextchr === '=')
                {
                    i++;
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

function makeRegExp(regexp:string):RegExp
{
    if (regexp.startsWith('/'))
    {
        const endidx = regexp.lastIndexOf('/');
        return new RegExp(regexp.substring(1, endidx), regexp.substr(endidx+1));
    }
    else
    {
        return new RegExp(regexp);
    }
}

function send(command:string){
    console.log('minecraft-be-ban> '+command);
    spawned.stdin.write(iconv.encode(command+'\n', charset));
}

class Command
{
    private readonly queue:ItemRun[] = [];
    private waiting:NodeJS.Timeout|undefined;
    private waitTo:number = 0;
    public static readonly all:Command[] = [];

    constructor(public readonly command:string)
    {
        Command.all.push(this);
    }

    retry(run:ItemRun)
    {
        run.runAt = Date.now() + run.item.delay;
        this.queue.push(run);
        if (this.waiting)
        {
            clearTimeout(this.waiting);
            this.waiting = undefined;
        }
        this.run();
    }

    run():void
    {
        this.waiting = undefined;
        const n = this.queue.length;
        if (n === 0) return;
        const last = this.queue[n-1];
        const now = Date.now();
        const nextDelay = Math.max(last.runAt, this.waitTo) - now;
        if (nextDelay > 0)
        {
            this.waiting = setTimeout(()=>this.run(), nextDelay);
        }
        else
        {
            last.run();
            this.queue.pop();
            this.waitTo = now + last.item.postDelay;
            this.waiting = setTimeout(()=>this.run(), last.item.postDelay);
        }
    }

    testAndRun(item:Item, arr:string[]):boolean
    {
        if (!item.compare(item.xuid, arr)) return false;
        
        const command = this.command.replace(/\$([0-9])/g, (match,v)=>v === '$' ? '$' : (arr[v] || ''));
        const itemrun = new ItemRun(item, command);
        this.queue.unshift(itemrun);
        if (this.waiting === undefined)
        {
            this.run();
        }
        return true;
    }
}

class Item
{
    public delay:number = 0;
    public compare:Compare = ()=>true;
    public command:Command|undefined;
    public xuid:string = '';
    public postDelay:number = 0;
    public failDetection:RegExp|undefined;

    clone():Item
    {
        const out = new Item;
        out.delay = this.delay;
        out.compare = this.compare;
        out.command = this.command;
        out.xuid = this.xuid;
        out.postDelay = this.postDelay;
        out.failDetection = this.failDetection;
        return out;
    }
}

class ItemRun
{
    public runAt:number;

    constructor(
        public readonly item:Item,
        public readonly command:string)
    {
        this.runAt = Date.now() + item.delay;
    }

    run()
    {
        send(this.command);
        if (this.item.failDetection)
        {
            if (failTestings.length > 10) failTestings.pop();
            failTestings.unshift(this);
        }
    }

    failTestAndRun(text:string):boolean
    {
        if (this.item.failDetection!.test(text))
        {
            this.item.command!.retry(this);
            return true;
        }
        return false;
    }
}

class Capture
{
    private readonly regexp:RegExp;
    private readonly items:Item[] = [];
    public static all:Capture[] = [];
    
    constructor(line:string)
    {
        Capture.all.push(this);
        this.regexp = makeRegExp(line);
    }

    testAndRun(text:string):void
    {
        const arr = this.regexp.exec(text);
        if (arr)
        {
            for (const item of this.items)
            {
                item.command!.testAndRun(item, arr);
            }
        }
    }

    addItem(item:Item):void
    {
        this.items.push(item);
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

let failTestings:ItemRun[] = [];

async function loadTriggers():Promise<void>
{
    Capture.all.length = 0;
    Command.all.length = 0;

    const fileName = 'triggers.txt';
    let item = new Item;
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
                    break;
                case 'compare':
                    item.compare = makeCompare(value);
                    break;
                case 'command':
                    item.command = new Command(value);
                    break;
                case 'delay':
                    item.delay = +value;
                    break;
                case 'post-delay':
                    item.postDelay = +value;
                    break;
                case 'fail-detection':
                    item.failDetection = makeRegExp(value);
                    break;
                default:
                    throw Error('Unknown label ignored: '+label);
                }
            }
            else
            {
                if (capture)
                {
                    item.xuid = line;
                    capture.addItem(item);
                    item = item.clone();
                }
            }
        }
        catch (err)
        {
            console.error(`minecraft-be-ban> ${fileName}(${lineNumber}): ${err.message}`);
        }
    }
}

function spawn(command:string, args:string[]):child_process.ChildProcessWithoutNullStreams
{
    console.log(command+' '+args.join(' '));
    return child_process.spawn(command, args);
}

(async()=>{

    {
        const runargs = process.argv.slice(2);
        let runexec = '.' + path.sep + 'bedrock_server';
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
            spawned = spawn('cmd', ['/s', '/c', runexec].concat(runargs));
        }
        else
        {
            spawned = spawn(runexec, runargs);
        }
        await loadTriggers();
        if (runexec === 'check') return;
    }


    const stdin = new LineDetector(command=>{
        if (command === 'update-triggers')
        {
            loadTriggers().then(()=>{
                console.log('minecraft-be-ban> Triggers updated')
            });
        }  
        else
        {
            spawned.stdin.write(iconv.encode(command+'\n', charset));
        }
    });
    const stdout = new LineDetector(out=>{
        if (failTestings.length !== 0)
        {
            const testing = failTestings;
            failTestings = [];
            for (let i=0;i<testing.length;)
            {
                if (testing[i].failTestAndRun(out))
                {
                    testing.splice(i, 1);
                    break;
                }
                else
                {
                    i++;
                }
            }
            failTestings.push(...testing);
        }

        for (const capture of Capture.all)
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