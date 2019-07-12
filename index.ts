#!/usr/bin/env node

import path = require('path');
import fs = require('fs');
import os = require('os');
import child_process = require('child_process');
import iconv = require('iconv-lite');

const TRIGGERS_TXT = 'triggers.txt';

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

// functions

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

const unique = {
    maps: new WeakMap<{new(param:any):any}, Map<any, any>>(),
    clear<PARAM, T>(cls:{new(param:PARAM):T}):void
    {
        unique.maps.delete(cls);
    },
    getMap<PARAM, T>(cls:{new(param:PARAM):T}):Map<PARAM, T>
    {
        let list = unique.maps.get(cls);
        if (!list)
        {
            list = new Map;
            unique.maps.set(cls, list);
        }
        return list;
    },
    set<PARAM, T extends {line:PARAM}>(cls:{new(param:PARAM):T}, value:T):void
    {
        const list = unique.getMap(cls);
        list.set(value.line, value);
    },
    get<PARAM, T>(cls:{new(param:PARAM):T}, param:PARAM):T
    {
        const list = unique.getMap(cls);
        let obj = list.get(param);
        if (!obj)
        {
            obj = new cls(param);
            list.set(param, obj);
        }
        return obj;
    }
};


type CompareFunc = (x:string, r:string[])=>unknown;

class Compare
{
    public readonly test:CompareFunc;

    constructor(public readonly line:string)
    {
        this.test = Compare.make(line);
    }

    static validate(line:string):void
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
    }

    static make(line:string):CompareFunc
    {
        line = line.trim();
        Compare.validate(line);
        return <CompareFunc>new Function('x', 'r', 'return '+line.replace(/\$([0-9])/g, 'r[$1]'));
    }

    static get(line:string):Compare
    {
        return unique.get(Compare, line);
    }
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

function replaceRegExpParameters(target:string, params:string[]):string
{
    return target.replace(/\$([0-9])/g, (match,v)=>v === '$' ? '$' : (params[v] || v || ''));
}

function asBool(value:string):boolean
{
    if (value === '1' || value === 'true' || value === 't')
    {
        return true;
    }
    else if (value === '0' || value === 'false' || value === 'f')
    {
        return false
    }
    throw Error('accept true or false: '+value);
}

function spawn(command:string, args:string[]):child_process.ChildProcessWithoutNullStreams
{
    console.log(command+' '+args.join(' '));
    return child_process.spawn(command, args);
}

function send(command:string){
    for (const cmd of command.split('\n'))
    {
        console.log('minecraft-be-ban> '+cmd);
    }
    spawned.stdin.write(iconv.encode(command+'\n', charset));
}

class Command
{
    private readonly queue:Running[] = [];
    private waiting:NodeJS.Timeout|undefined;
    private waitTo:number = 0;

    constructor(public readonly line:string)
    {
    }

    static get(line:string):Command
    {
        return unique.get(Command, line);
    }

    retry(run:Running)
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

    testAndRun(item:PropertySet, arr:string[]):boolean
    {
        if (item.compare)
        {
            if (!item.compare.test(item.xuid, arr)) return false;
        }
        
        const itemrun = new Running(item, this.line, arr);
        this.queue.unshift(itemrun);
        if (this.waiting === undefined)
        {
            this.run();
        }
        return true;
    }
}

class PropertySet
{
    public capture?:Capture;
    public delay:number = 0;
    public compare?:Compare;
    public command?:Command;
    public xuid:string = '';
    public postDelay:number = 0;
    public failDetection:string = '';
    public repeatCount:number = -1;
    public stop:boolean = false;

    clone():PropertySet
    {
        const out = new PropertySet;
        out.capture = this.capture;
        out.delay = this.delay;
        out.compare = this.compare;
        out.command = this.command;
        out.xuid = this.xuid;
        out.postDelay = this.postDelay;
        out.failDetection = this.failDetection;
        out.repeatCount = this.repeatCount;
        out.stop = this.stop;
        return out;
    }
}

class Running
{
    public runAt:number;
    public readonly command:string;
    private repeat:number;
    private failDetection?:RegExp;
    private static failTestings:Running[] = [];

    constructor(
        public readonly item:PropertySet,
        command:string,
        params:string[])
    {
        this.repeat = item.repeatCount || -1;
        this.command = replaceRegExpParameters(command, params);
        this.runAt = Date.now() + item.delay;
        if (this.item.failDetection)
        {
            this.failDetection = makeRegExp(replaceRegExpParameters(this.item.failDetection, params));
        }
    }

    run()
    {
        if (this.repeat === 0) return;
        this.repeat--;
        send(this.command);

        if (this.repeat && this.failDetection)
        {
            if (Running.failTestings.length > 10) Running.failTestings.pop();
            Running.failTestings.unshift(this);
        }
    }

    failTestAndRun(text:string):boolean
    {
        if (this.failDetection!.test(text))
        {
            this.item.command!.retry(this);
            return true;
        }
        return false;
    }

    static failTest(out:string):boolean
    {
        let finded = false;
        if (Running.failTestings.length !== 0)
        {
            const testing = Running.failTestings;
            Running.failTestings = [];
            for (let i=0;i<testing.length;)
            {
                if (testing[i].failTestAndRun(out))
                {
                    testing.splice(i, 1);
                    finded = true;
                    break;
                }
                else
                {
                    i++;
                }
            }
            Running.failTestings.push(...testing);
        }
        return finded;
    }
}

class Capture
{
    private readonly regexp:RegExp;
    private readonly items:PropertySet[] = [];
    private static readonly registered:Capture[] = [];
    
    constructor(public readonly line:string)
    {
        this.regexp = makeRegExp(line);
    }

    static get(line:string):Capture
    {
        return unique.get(Capture, line);
    }

    testAndRun(text:string):boolean
    {
        const arr = this.regexp.exec(text);
        if (arr)
        {
            for (const item of this.items)
            {
                if (item.command!.testAndRun(item, arr))
                {
                    if (item.stop) return true;
                }
            }
        }
        return false;
    }

    addItem(item:PropertySet):void
    {
        if (this.items.length === 0)
        {
            Capture.registered.push(this);
        }
        this.items.push(item);
    }

    static clear():void
    {
        for (const capture of Capture.registered)
        {
            capture.items.length = 0;
        }
        Capture.registered.length = 0;
    }

    static testAndRun(out:string):void
    {
        for (const capture of Capture.registered)
        {
            if (capture.testAndRun(out)) return;
        }
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

// predefined property set
const predefined:{[key:string]:PropertySet} = {
    Ban: new PropertySet,
    Advanture: new PropertySet,
};
predefined.Ban.capture = Capture.get("/] Player connected: (.+), xuid: (.+)$/");
predefined.Ban.compare = Compare.get("x == $2");
predefined.Ban.command = Command.get('kick "$2"');
predefined.Ban.delay = 500;
predefined.Ban.postDelay = 0;
predefined.Ban.failDetection = "/^Could not find player $2$/";
predefined.Ban.repeatCount = 10;
predefined.Ban.stop = true;

predefined.Advanture.capture = predefined.Ban.capture;
predefined.Advanture.compare = predefined.Ban.compare;
predefined.Advanture.command = Command.get('gamemode a "$1"');
predefined.Advanture.delay = 2000;
predefined.Advanture.postDelay = 2000;
predefined.Advanture.failDetection = "/^No targets matched selector$/"; // gamemode can set after loading, Need to retry
predefined.Advanture.repeatCount = 10;
predefined.Advanture.stop = false;

// Properties
class Properties<OBJ extends {}>
{
    private readonly map = new Map<string, {
        name:keyof OBJ,
        cast:(value:string)=>any,
        add?:(orivalue:any, value:any)=>any,
    }>();

    regist<PROP extends keyof OBJ>(name:PROP, cast:(value:string)=>OBJ[PROP], add?:(orivalue:OBJ[PROP], value:string)=>OBJ[PROP]):void
    {
        if (typeof name === 'string')
        {
            const reprop = name.replace(/[A-Z]/g, str=>'-'+str.toLocaleLowerCase());
            this.map.set(reprop, {
                name,
                cast,
                add
            });
        }
    }

    put(target:OBJ, prop:string, value:string):void
    {
        if (prop.endsWith('+'))
        {
            prop = prop.substr(0, prop.length-1).trim();
            const cast = this.map.get(prop);
            if (!cast) throw Error('Unknown property: '+prop);
            if (!cast.add) throw Error('un-addable property: '+prop);
            target[cast.name] = cast.add(target[cast.name], value);
        }
        else
        {
            const cast = this.map.get(prop);
            if (!cast) throw Error('Unknown property: '+prop);
            target[cast.name] = cast.cast(value);
        }
    }
}

const properties = new Properties<PropertySet>();
properties.regist('capture', Capture.get);
properties.regist('compare', Compare.get, (ori, value)=>Compare.get(ori ? `(${ori.line})&&(${value})` : value));
properties.regist('command', Command.get, (ori, value)=>Command.get(ori ? ori.line+'\n'+value : value));
properties.regist('delay', value=>+value, (ori, value)=>ori+(+value));
properties.regist('postDelay', value=>+value, (ori, value)=>ori+(+value));
properties.regist('failDetection', value=>value, (ori, value)=>ori+(+value));
properties.regist('repeatCount', value=>+value, (ori, value)=>ori+(+value));
properties.regist('stop', value=>asBool(value));

// parser
async function loadTriggers():Promise<void>
{
    unique.clear(Capture);
    unique.clear(Compare);
    unique.clear(Command);
    Capture.clear();
    for (const key in predefined)
    {
        const item = predefined[key];
        if (item.capture) unique.set(Capture, item.capture);
        if (item.compare) unique.set(Compare, item.compare);
        if (item.command) unique.set(Command, item.command);
    }

    const fileName = TRIGGERS_TXT;
    let item = new PropertySet;

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
        
        try
        {
            if (line.startsWith('<') && line.endsWith('>'))
            {
                const name = line.substring(1, line.length-1).trim();
                const propset = predefined[name];
                if (propset)
                {
                    item = propset.clone();
                }
                else
                {
                    throw Error('Unknown Propert Set: '+name);
                }
            }
            else
            {
                const labelSplit = line.indexOf(':');
                if (labelSplit !== -1)
                {
                    const label = line.substr(0, labelSplit).trim();
                    const value = line.substr(labelSplit+1).trim();
                    properties.put(item, label, value);
                }
                else if (item.capture)
                {
                    item.xuid = line;
                    item.capture.addItem(item);
                    item = item.clone();
                }
            }
        }
        catch (err)
        {
            console.error(`minecraft-be-ban> ${fileName}(${lineNumber}): ${err.message}`);
        }
    }
    console.log('minecraft-be-ban> Triggers updated')
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

    

    let waitLoadTrigger:NodeJS.Timeout|undefined;
    function watchCallback(event:string):void
    {
        if (event === 'change')
        {
            if (waitLoadTrigger)
            {
                clearTimeout(waitLoadTrigger);
            }
            waitLoadTrigger = setTimeout(()=>{
                waitLoadTrigger = undefined;
                loadTriggers();
            }, 300);
        }
        else if (event === 'rename')
        {
            console.log('minecraft-be-ban> detect triggers.txt renamed');
            watcher.close();
            watcher = fs.watch(TRIGGERS_TXT, watchCallback);
        }
    }
    let watcher = fs.watch(TRIGGERS_TXT, watchCallback);

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
        if (Running.failTest(out)) return;
        Capture.testAndRun(out);
    });
    function onstdin(chunk:Buffer):void
    {
        stdin.add(chunk.toString('utf8'));
    }
    process.stdin.on('error', ()=>{});
    process.stdin.on('data', onstdin);
    spawned.on('close', ()=>{
        watcher.close();
        process.stdin.removeListener('data', onstdin);
        process.stdin.end();
    });
    spawned.stdout.on('data', chunk=>{
        const text = iconv.decode(chunk, charset);
        process.stdout.write(text);
        stdout.add(text);
    });
    spawned.stderr.on('data', chunk=>{
        const text = iconv.decode(chunk, charset);
        process.stderr.write(text);
        stdout.add(text);
    });

})().catch(err=>console.error(err));