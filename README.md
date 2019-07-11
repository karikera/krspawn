
## How it works?
It will pipes terminal to bedrock server and watch log  
It made to target vanila Bedrock Server but you can modify it to fit for anything  

## How can I install it?
it is NPM based module  
First, You need to install node.js  
And you can install it with `npm install -g minecraft-be-ban` command from console

## How can I run it?
1. Move to Bedrock Server directory
2. Initialize with `minecraft-be-ban check` command!
    It will copys `triggers.txt` to working directory
3. Modify `triggers.txt` to ban some XUIDs
4. Run `minecraft-be-ban`. it will run `./bedrock_server`. You need to run 
    If you use linux then you can run with `LD_LIBRARY_PATH=. minecraft-be-ban`

## Help
Question or Report: https://github.com/karikera/minecraft-be-ban/issues  
Discord: https://discord.gg/uBA4eSz  
My mothertongue is korean, My english is bad ´ㅡ`  

## Commands
* `minecraft-be-ban init`: It will copies and validates `triggers.txt`
* `minecraft-be-ban`: It will runs `./bedrock_server`
* `minecraft-be-ban [commands]`: It will runs `[commands]`
