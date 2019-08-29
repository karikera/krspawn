
## What is this?
Spawn & Line Spliting  
Support 932, 936, 949, 950 codepages for Windows  

```ts
// TypeScript

import { Spawn, StdInListener } from '../index';

function spawn():Spawn
{
    const cmd = new Spawn('cmd'); 
    cmd.on('open', ()=>{
        console.log('opened');
    });
    cmd.on('close', ()=>{
        console.log('closed');
    });
    cmd.on('stdout', message=>{
        console.log(message);
    });
    return cmd;
}

let cmd = spawn();

const stdinListener = new StdInListener(line=>{
    switch (line)
    {
    case 'aaaa':
        console.log('command AAAA!');
        break;
    case 'bbbb':
        console.log('command BBBB!');
        break;
    case 'restart':
        cmd.stdin('exit');
        cmd.on('close', ()=>{
            cmd = spawn();
        });
        break;
    case 'exit':
        cmd.stdin('exit');
        cmd.on('close', ()=>{
            stdinListener.remove();
        });
        break;
    default:
        cmd.stdin(line);
        break;
    }
});

setInterval(()=>{
    stdinListener.clearLine();
    console.log('disturb message');
    stdinListener.restore();
},5000);

```