
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
            clearInterval(interval);
        });
        break;
    default:
        cmd.stdin(line);
        break;
    }
});

const interval = setInterval(()=>{
    console.log('disturb message');
},5000);
