import os
import zipfile
import shutil
import subprocess
import time
from flask import Flask, render_template, request, send_file, jsonify
from io import BytesIO
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.secret_key = os.urandom(24) # Set your secret key
socketio = SocketIO(app, async_mode='eventlet', cors_allowed_origins="*")
app.config['ALLOWED_EXTENSIONS'] = {'zip'}
socketio = SocketIO(app, manage_session=True)  # Initialize SocketIO with the app

NEW_DIRECTORY_PATH = '/root/micropython/ports/stm32/modules'

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def delete_all_files_in_directory(directory_path):
    try:
        for filename in os.listdir(directory_path):
            file_path = os.path.join(directory_path, filename)
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        return "Old files deleted successfully."
    except subprocess.CalledProcessError as e:
        print(f"Error deleting files: {e.stderr}")
        return f'An error occurred while deleting files: {e.stderr}'

def process_zip_file(file, board_name):
    socketio.emit('progress', {'message': 'Started processing ZIP file... <i class="fa fa-spinner fa-spin"></i>'})
    time.sleep(1)
    with zipfile.ZipFile(file, 'r') as zip_ref:
        file_list = zip_ref.namelist()

        non_py_files = [f for f in file_list if not f.endswith('.py')]
        if non_py_files:
            return jsonify({"status": "error", "message": f"Error: The following non-.py files were found: {', '.join(non_py_files)}"}), 400

        os.makedirs(NEW_DIRECTORY_PATH, exist_ok=True)
        socketio.emit('progress', {'message': 'ZIP file processed successfully! <i class="fa fa-check-circle"></i>'})
        socketio.emit('progress', {'message': 'Deleting old files from target directory... <i class="fa fa-spinner fa-spin"></i>'})
        delete_all_files_in_directory(NEW_DIRECTORY_PATH)
        time.sleep(1)
        socketio.emit('progress', {'message': 'Old files deleted successfully! <i class="fa fa-check-circle"></i>'})

        saved_files = []
        for zip_file in file_list:
            if zip_file.endswith('.py'):
                extracted_path = os.path.join(NEW_DIRECTORY_PATH, zip_file)
                os.makedirs(os.path.dirname(extracted_path), exist_ok=True)
                with zip_ref.open(zip_file) as extracted_file, open(extracted_path, 'wb') as f_out:
                    shutil.copyfileobj(extracted_file, f_out)
                saved_files.append(zip_file)
                socketio.emit('progress', {'message': f'Successfully extracted {zip_file} <i class="fa fa-check-circle"></i>'})

        parent_directory = os.path.dirname(NEW_DIRECTORY_PATH)
        os.chdir(parent_directory)

        try:
            socketio.emit('progress', {'message': 'Running the make command for the build... <i class="fa fa-spinner fa-spin"></i>'})
            result = subprocess.run(
                ['make', f'BOARD={board_name}'],
                cwd='/root/micropython/ports/stm32',
                capture_output=True, text=True, check=True
            )
            socketio.emit('progress', {'message': f'Successfully build for {board_name}! <i class="fa fa-check-circle"></i>'})
        except subprocess.CalledProcessError as e:
            socketio.emit('progress', {'message': f"Error running make command: {e.stderr}"})
            return jsonify({"status": "error", "message": f"Error running make command: {e.stderr}"}), 400

        build_directory = os.path.join(parent_directory, f'build-{board_name}')
        if os.path.exists(build_directory) and os.path.isdir(build_directory):
            build_files = os.listdir(build_directory)

            selected_file_names = ['firmware0.bin', 'firmware1.bin', 'firmware.hex', 'firmware.dfu']
            selected_files = [file for file in build_files if file in selected_file_names]

            if selected_files:
                zip_file_path = os.path.join(parent_directory, 'selected_files.zip')
                socketio.emit('progress', {'message': 'Creating a ZIP file of selected build files... <i class="fa fa-spinner fa-spin"></i>'})
                with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    for selected_file in selected_files:
                        file_path = os.path.join(build_directory, selected_file)
                        zip_file.write(file_path, selected_file)
                        socketio.emit('progress', {'message': f'Successfully added {selected_file} to the ZIP file <i class="fa fa-check-circle"></i>'})
                    socketio.emit('progress', {'message': 'Build files successfully packaged into ZIP <i class="fa fa-check-circle"></i>'})
                
                # Return the success response with the download link and message
                return jsonify({
                    "status": "success",
                    "zip_file": f"/download/{os.path.basename(zip_file_path)}"
                }), 200
            else:
                return jsonify({
                    "status": "error",
                    "message": "No selected files found"
                }), 400
        else:
            return jsonify({
                "status": "error",
                "message": f"build-{board_name} directory not found."
            }), 400


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400

    file = request.files['file']
    board_name = request.form['board_name']

    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    if file and allowed_file(file.filename):
        return process_zip_file(file, board_name)

    return jsonify({"status": "error", "message": "Only ZIP files are allowed"}), 400


@app.route('/download/<filename>')
def download_file(filename):
    file_path = os.path.join(os.path.dirname(NEW_DIRECTORY_PATH), filename)
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
    else:
        return 'File not found', 404

# Route for the Device tab
@app.route('/device')
def device():
    return render_template('device.html')

# Route for the Settings tab
@app.route('/settings')
def settings():
    return render_template('settings.html')

# Route for the DFU tab
@app.route('/dfu')
def dfu():
    return render_template('dfu.html')

# Route for the Tcpftp tab
@app.route('/tcpftp')
def tcpftp():
    return render_template('tcpftp.html')

# Route for the BUILD tab
@app.route('/build')
def build():
    return render_template('build.html')


if __name__ == "__main__":
    socketio.run(app, host='0.0.0.0', port=9000, debug=True)
