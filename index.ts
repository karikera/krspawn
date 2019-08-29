
import os = require('os');
import child_process = require('child_process');
import iconv = require('iconv-lite');
import { EventEmitter } from 'events';

let charset = 'utf8';
const CPMAP = new Map([
    ['932','CP932'],
    ['936','CP936'],
    ['949','CP949'],
    ['950','CP950'],
    // TODO: It need more codepages!
]);

interface StdOut extends NodeJS.WriteStream
{
    clearLine():void;
}
interface StdIn extends NodeJS.ReadStream
{
    setRawMode(rawMode:boolean):void;
}
const stdout = <StdOut>process.stdout;
const stdin = <StdIn>process.stdin;

const children = new Set<Spawn>();

// functions
function spawn(command:string, args?:string[]):child_process.ChildProcessWithoutNullStreams
{
    if (args)
    {
        console.log(command+' '+args.join(' '));
    }
    else
    {
        console.log(command);
    }
    return child_process.spawn(command, args);
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

class LineDetector
{
    private buffer:string = '';
    private breaked:boolean = false;

    constructor(private readonly callback:(line:string)=>void)
    {
    }

    add(text:string):void
    {
        let idx = 0;
        for (;;)
        {
            let cmdend = text.indexOf('\n', idx);
            if (cmdend !== -1)
            {
                const next = cmdend+1;
                if (text.charAt(cmdend-1) === '\r') cmdend--;
                this.buffer += text.substring(idx, cmdend);
                this.callback(this.buffer);
                idx = next;
                this.buffer = '';
            }
            else
            {
                this.buffer += text.substr(idx);
                break;
            }
        }
    }

    getBuffer():string
    {
        return this.buffer;
    }
}

export interface Spawn
{
    addListener(event: 'stdout', listener: (message: string) => void): this;
    on(event: 'stdout', listener: (message: string) => void): this;
    emit(event: 'stdout', message:string): boolean;

    addListener(event: 'close', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    emit(event: 'close'): boolean;
    
    addListener(event: 'open', listener: () => void): this;
    on(event: 'open', listener: () => void): this;
    emit(event: 'open'): boolean;
}

const emptyFunc = ()=>{};

export class StdInListener
{
    private restoreRequest:NodeJS.Timeout|null = null;
    private buffer:string = '';
    private removed = false;
    private readonly oldlog:(this:Console, message?:any, ...params:any[])=>void;
    private readonly onstdin = (key:string)=>{
        if (this.restoreRequest)
        {
            clearTimeout(this.restoreRequest);
            this.restoreRequest = null;
            stdout.write(this.buffer);
        }
        if ( key === '\u0003' ) {
            for (const child of children)
            {
                child.kill('SIGINT');
            }
            process.exit(-1);
        }
        else
        {
            stdout.write(key);
            switch (key)
            {
            case '\r':
                this.listener(this.buffer);
                this.buffer = '';
                stdout.write('\n');
                break;
            case '\b':
                stdout.write(' ');
                stdout.write('\b');
                this.buffer = this.buffer.substr(0, this.buffer.length-1);
                break;
            default:
                this.buffer += key;
                break;
            }
        }
    };

    constructor(private readonly listener:(data:string)=>void)
    {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        stdin.on('error', emptyFunc);
        stdin.on('data', this.onstdin);
        
        const that = this;
        this.oldlog = console.log;
        console.log = function(message?:any, ...params:any[]){
            if (that.buffer !== '')
            {
                if (that.restoreRequest)
                {
                    clearTimeout(that.restoreRequest);
                }
                that.restoreRequest = setTimeout(()=>{
                    that.restoreRequest = null;
                    stdout.write(that.buffer);
                }, 100);

                stdout.write('\r');
                stdout.clearLine();
                that.oldlog.apply(this, arguments as any);
            }
            else
            {
                that.oldlog.apply(this, arguments as any);
            }
        };

    }

    remove():void
    {
        if (this.removed) return;
        this.removed = true;
        stdin.removeListener('error', emptyFunc);
        stdin.removeListener('data', this.onstdin);
        stdin.pause();
        stdin.setRawMode(false);
        console.log = this.oldlog;
    }
}

export interface Removable
{
    remove():void;
}

export class Spawn extends EventEmitter
{
    private spawned:child_process.ChildProcessWithoutNullStreams|null = null;
    private killed = false;

    stdin(message:string):void
    {
        if (!this.spawned)
        {
            console.error('Not running');
            return;
        }
        this.spawned.stdin.write(iconv.encode(message+'\n', charset));
    }

    constructor(command:string, args?:string[])
    {
        super();
        children.add(this);

        (async()=>{
            const isWindows = os.platform().startsWith('win32');        
            if (isWindows)
            {
                const cp = await exec('chcp');
                const s = cp.indexOf(':') + 1; 
                const e = cp.indexOf('\n', s)-1;
                const codepage = cp.substring(s, e).trim();
                charset = CPMAP.get(codepage) || 'utf8';
                command = command.replace(/\//g, '\\');
                let nargs = ['/s', '/c', command]; // for call global binary
                if (args) nargs = nargs.concat(args);
                if (this.killed)
                {
                    this.emit('close');
                    return;
                }
                this.spawned = spawn('cmd', nargs);
            }
            else
            {
                await new Promise(resolve=>{ setTimeout(resolve, 0); }); // sync with windows
                if (this.killed)
                {
                    this.emit('close');
                    return;
                }
                this.spawned = spawn(command, args);
            }

            const stdout = new LineDetector(out=>{
                if (!this.emit('stdout', out))
                {
                    console.log(out);
                }
            });
            this.spawned.on('close', ()=>{
                children.delete(this);
                this.emit('close');
            });
            this.spawned.stdout.on('data', chunk=>{
                const text = iconv.decode(chunk, charset);
                stdout.add(text);
            });
            this.spawned.stderr.on('data', chunk=>{
                const text = iconv.decode(chunk, charset);
                process.stderr.write(text);
            });
            this.emit('open');
        })();
    }

    kill(signal?:string):void
    {
        if (this.killed) return;
        this.killed = true;
        if (this.spawned)
        {
            this.spawned.kill(signal);
            this.spawned = null;
        }
    }
}

