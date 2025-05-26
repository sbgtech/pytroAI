from app import app, socketio

if __name__ == "__main__":
    # Use eventlet or gevent in production
    socketio.run(app, host="0.0.0.0", port=9090)
