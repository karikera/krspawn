
## What is this?
It's just terminal piping library  

```ts
// TypeScript

import { ConsolePipe } from 'krpipe';
const server = new ConsolePipe('./bedrock_server');
server.on('open', ()=>{

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
            server.stdout(server.command);
            break;
        }
    });

    server.on('stdout', message=>{
        if (message.endsWith('Server Started.'))
        {
            console.log('And Piped.');
        }
    });
});

```