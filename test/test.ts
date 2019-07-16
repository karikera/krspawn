
import { Spawn } from '../index';

const server = new Spawn('./bedrock_server'); 
server.on('open', ()=>{
    console.log('opened');
});
server.on('close', ()=>{
    console.log('closed');
});
server.on('stdin', command=>{
    switch (command)
    {
    case 'aaaa':
        console.log('command AAAA!');
        break;
    case 'bbbb':
        console.log('command BBBB!');
        break;
    default:
        server.stdout(command);
        break;
    }
});
server.on('stdout', message=>{
    if (message.endsWith('Server started.'))
    {
        console.log('And Piped.');
    }
});


