import time
import os

print(f"Busy process started! PID: {os.getpid()}")
print("Watch the dashboard CPU gauge spike...")

try:
    while True:
        x = 0
        for i in range(5000000):
            x += i*i
        time.sleep(0.1)
        
except KeyboardInterrupt:
    print("Stopped.")