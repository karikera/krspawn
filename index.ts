
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

export interface Spawn
{
    addListener(event: 'stdout', listener: (message: string) => void): this;
    on(event: 'stdout', listener: (message: string) => void): this;
    emit(event: 'stdout', message:string): boolean;

    addListener(event: 'stdin', listener: (message: string) => void): this;
    on(event: 'stdin', listener: (message: string) => void): this;
    emit(event: 'stdin', message:string): boolean;
    
    addListener(event: 'close', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    emit(event: 'close'): boolean;
    
    addListener(event: 'open', listener: () => void): this;
    on(event: 'open', listener: () => void): this;
    emit(event: 'open'): boolean;
}

export class Spawn extends EventEmitter
{
    private spawned?:child_process.ChildProcessWithoutNullStreams;

    stdout(message:string):void
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
                this.spawned = spawn('cmd', nargs);
            }
            else
            {
                this.spawned = spawn(command, args);
                await new Promise(resolve=>{ setTimeout(resolve, 0); }); // sync with windows
            }

            const stdin = new LineDetector(command=>{
                if (!this.emit('stdin', command))
                {
                    this.stdout(command);
                }
            });
            const stdout = new LineDetector(out=>{
                this.emit('stdout', out);
            });
            function onstdin(chunk:Buffer):void
            {
                stdin.add(chunk.toString('utf8'));
            }
            process.stdin.on('error', ()=>{});
            process.stdin.on('data', onstdin);
            this.spawned.on('close', ()=>{
                process.stdin.removeListener('data', onstdin);
                process.stdin.end();
                this.emit('close');
            });
            this.spawned.stdout.on('data', chunk=>{
                const text = iconv.decode(chunk, charset);
                process.stdout.write(text);
                stdout.add(text);
            });
            this.spawned.stderr.on('data', chunk=>{
                const text = iconv.decode(chunk, charset);
                process.stderr.write(text);
                stdout.add(text);
            });
            this.emit('open');
        })();
    }
}

