import asyncio
import json
import psutil
import uvicorn
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

clients: List[WebSocket] = []
AUDIT_LOG = []
LOG_FILE = "audit_log.json"
CPU_CORES = psutil.cpu_count(logical=True) or 1
LAST_NET_IO = psutil.net_io_counters()

def load_logs():
    global AUDIT_LOG
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, "r") as f:
                AUDIT_LOG = json.load(f)
        except Exception:
            AUDIT_LOG = []

def save_log_entry(entry):
    AUDIT_LOG.append(entry)
    try:
        with open(LOG_FILE, "w") as f:
            json.dump(AUDIT_LOG, f, indent=2)
    except Exception as e:
        print(f"Error saving log: {e}")

def get_system_snapshot():
    global LAST_NET_IO
    try:
        sys_stats = {
            "cpu_percent": psutil.cpu_percent(interval=None),
            "mem_percent": psutil.virtual_memory().percent,
            "ts": datetime.now().strftime("%H:%M:%S")
        }

        try:
            disk = psutil.disk_usage('/')
            sys_stats["disk_percent"] = disk.percent
        except:
            sys_stats["disk_percent"] = 0

        curr_net = psutil.net_io_counters()
        sent_speed = (curr_net.bytes_sent - LAST_NET_IO.bytes_sent) / 1024
        recv_speed = (curr_net.bytes_recv - LAST_NET_IO.bytes_recv) / 1024
        
        sys_stats["net_sent_speed"] = round(sent_speed, 1)
        sys_stats["net_recv_speed"] = round(recv_speed, 1)
        LAST_NET_IO = curr_net

        sys_stats["uptime"] = str(datetime.now() - datetime.fromtimestamp(psutil.boot_time())).split('.')[0]

        procs = []
        for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info', 'status', 'cmdline']):
            try:
                p_info = p.info
                if p_info['status'] == psutil.STATUS_ZOMBIE: continue
                if p_info['pid'] == 0 or p_info['name'] == 'System Idle Process': continue
                
                mem_mb = 0
                if p_info.get('memory_info'):
                    mem_mb = p_info['memory_info'].rss / (1024 * 1024)

                raw_cpu = p_info['cpu_percent'] or 0.0
                normalized_cpu = round(raw_cpu / CPU_CORES, 1)

                procs.append({
                    "pid": p_info['pid'],
                    "name": p_info['name'] or "Unknown",
                    "cpu": normalized_cpu,
                    "mem": round(mem_mb, 1),
                    "cmd": " ".join(p_info['cmdline'] or [])
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        procs.sort(key=lambda x: x['cpu'], reverse=True)
        return {"system": sys_stats, "processes": procs[:100]}
    except Exception:
        return {"system": {}, "processes": []}

async def broadcast_metrics():
    while True:
        if clients:
            data = get_system_snapshot()
            json_data = json.dumps(data)
            for client in clients[:]:
                try:
                    await client.send_text(json_data)
                except:
                    if client in clients: clients.remove(client)
        await asyncio.sleep(2)

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_logs()
    task = asyncio.create_task(broadcast_metrics())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.path.exists("static"):
    os.makedirs("static")

@app.websocket("/ws/metrics")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.append(ws)
    try:
        while True:
            await ws.receive_text()
             
    except WebSocketDisconnect:
        if ws in clients:
            clients.remove(ws)

@app.post("/api/process/{pid}/{action}")
async def manage_process(pid: int, action: str):
    try:
        process = psutil.Process(pid)
        if action == "suspend":
            process.suspend()
        elif action == "resume":
            process.resume()
        elif action == "terminate":
            process.terminate()
        else:
            raise HTTPException(400, "Invalid action")
        
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "pid": pid,
            "action": action,
            "status": "Success"
        }
        save_log_entry(log_entry)
        return log_entry
    except psutil.NoSuchProcess:
        raise HTTPException(404, "Process not found")
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/audit")
def get_audit_log():
    return AUDIT_LOG

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)