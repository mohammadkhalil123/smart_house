# Running the backend on the university machine

## 1. Connect and check the environment
```bash
ssh <your_login>@etu-web2.ut-capitole.fr
node -v        # needs >= 18; if missing, try: module avail node   (or ask the IT service)
npm -v
```

## 2. Find how the `mongo` shell connects (do not guess)
```bash
ps aux | grep -i mongo | grep -v grep     # shows mongod host/port/--auth if it runs on this machine
ss -ltn | grep 27017                      # is something listening locally?
cat ~/.mongorc.js 2>/dev/null             # shell startup config, if any
mongo --eval 'db.getMongo()' Rpi29        # prints the host:port the shell actually uses
mongo --eval 'db.getMongo()' --quiet Rpi29 && echo "no auth needed for this db"
```
- If the shell shows `127.0.0.1:27017` and you never typed a login, the URI is
  `mongodb://127.0.0.1:27017/`.
- If it shows another host (e.g. `mongodb.xxx:27017`), use that host.
- If you must authenticate in the shell (`db.auth(...)`), use
  `mongodb://USER:PASSWORD@HOST:PORT/?authSource=Rpi29` (URL-encode special characters).
  Ask the university IT if you do not know the MongoDB credentials; they are not the SSH password
  unless they say so.

## 3. Install and configure
```bash
# upload the folder once (from your PC):  scp -r backend <login>@etu-web2.ut-capitole.fr:~/
cd ~/backend
npm install
npm run build
cp .env.example .env
nano .env
```
Set in `.env`:
```
PORT=3000                  # pick a free port: ss -ltn | grep 3000
HOST=127.0.0.1
DATA_SOURCE=mongodb
MONGODB_URI=<from step 2>
MONGODB_DATABASE=Rpi29
MEASUREMENT_TIME_ZONE=Europe/Paris
```
`chmod 600 .env` so only you can read it.

## 4. Test MongoDB (read-only)
```bash
npm run check:mongo
```
Expect: `Collections in "Rpi29": Measures, Sprinkler` and their document counts.

## 5. Start the API
```bash
npm start                                   # foreground, for testing
curl http://127.0.0.1:3000/api/health       # in a second SSH session
curl "http://127.0.0.1:3000/api/measures/latest?place=1"
# long-running (only if the university allows it):
nohup npm start > backend.log 2>&1 &
```
Stop it with `pkill -f "node dist/server.js"`.

## 6. Open it from your PC (SSH tunnel; nothing is exposed publicly)
On your PC, in a new terminal, leave it open:
```bash
ssh -L 3000:127.0.0.1:3000 <login>@etu-web2.ut-capitole.fr
```
Then browse to `http://localhost:3000/api/health`.

## 7. Angular
Run the Angular dev server on your PC while the tunnel is open, and proxy `/api` to
`http://localhost:3000` (`proxy.conf.json`: `{"/api": {"target": "http://localhost:3000"}}`,
then `ng serve --proxy-config proxy.conf.json`). No CORS setup needed in that case.
If instead Angular is served from another origin, set `CORS_ORIGINS=http://localhost:4200` in `.env`.
To host Angular on the university machine too, run `ng build` and serve `dist/` with a static
server on a second port, tunnelled the same way.

## Troubleshooting
- `Cannot connect to MongoDB database ...`: wrong host/port in `MONGODB_URI`; redo step 2.
- `Authentication failed`: wrong user/password or `authSource`.
- `EADDRINUSE`: port taken; change `PORT` and the tunnel accordingly.
- Process killed after logout: the server may not allow background jobs; ask IT or use `tmux`/`screen` if installed.
