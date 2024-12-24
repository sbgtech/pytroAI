import os
import zipfile
import shutil
import subprocess
import time, datetime, re
from flask import Flask, render_template, request, send_file, jsonify, redirect, url_for
from io import BytesIO
from flask_socketio import SocketIO, emit
import eventlet

app = Flask(__name__)
app.secret_key = os.urandom(24) # Set your secret key
socketio = SocketIO(app, cors_allowed_origins="*")
app.config['ALLOWED_EXTENSIONS'] = {'zip'}
socketio = SocketIO(app, manage_session=True)  # Initialize SocketIO with the app
user_rooms = {}

NEW_DIRECTORY_PATH = '/root/micropython/ports/stm32/modules'
FIRMWARE_DIRECTORY_PATH = '/root/micropython/ports/stm32'

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
        print(f"All files deleted in: {directory_path}")
        return f"All files deleted in: {directory_path}"
    except Exception as e:
        print(f"Error deleting files in {directory_path}: {e}")
        return f"An error occurred while deleting files in {directory_path}: {e}"

# A dictionary to store user sessions and their respective rooms (sid)
user_sessions = {}

# Handle SocketIO Connection event
@socketio.on('connect')
def handle_connect():
    user_room = request.sid
    user_sessions[user_room] = {}  # Store user session if necessary
    print(f"User connected: {user_room}")
    # Send an initial message or handle room-based communication

# Handle SocketIO Disconnection event
@socketio.on('disconnect')
def handle_disconnect():
    user_room = request.sid
    if user_room in user_sessions:
        del user_sessions[user_room]  # Remove user session from the dictionary
    print(f"User disconnected: {user_room}")

def update_firmware_info_file(file_path, version, date):
    # Open the firmware_info.h file and read it
    with open(file_path, 'r') as f:
        lines = f.readlines()

    # Modify the lines for the version and date
    with open(file_path, 'w') as f:
        for line in lines:
            if "#define MICROPY_FIRMWARE_VERSION" in line:
                f.write(f'#define MICROPY_FIRMWARE_VERSION "{version}"\n')
            elif "#define MICROPY_FIRMWARE_DATE" in line:
                f.write(f'#define MICROPY_FIRMWARE_DATE "{date}"\n')
            else:
                f.write(line)

def create_manifest_file(board_name_id, user_id):
    # Define the path for the new manifest file
    manifest_file_path = os.path.join('/root/micropython/ports/stm32/manifest', f'manifest_{user_id}.py')
    
    # Create the manifest file and write content to it
    with open(manifest_file_path, 'w') as manifest_file:
        manifest_file.write(f"""\
include("$(MPY_DIR)/extmod/uasyncio")
#require("dht")
#require("onewire")
freeze("$(PORT_DIR)/modules/{board_name_id}")
""")
    return manifest_file_path

def process_zip_file(file, board_name, user_id, user_room):
    board_name_id = board_name+'_'+user_id
    modules_directory_path = os.path.join(NEW_DIRECTORY_PATH, board_name_id)
    with zipfile.ZipFile(file, 'r') as zip_ref:
        file_list = zip_ref.namelist()
        non_py_files = [f for f in file_list if not f.endswith('.py')]
        if non_py_files:
            # socketio.emit('progress', {
            #     'message': f"Error: The following non-.py files were found: {', '.join(non_py_files)}"
            # }, room=user_room)
            return jsonify({"status": "error", "message": f"Error: The following non-.py files were found: {', '.join(non_py_files)}"}), 400
        print("Started processing ZIP file...")
        socketio.emit('progress', {'message': 'Started processing ZIP file... <i class="fa fa-spinner fa-spin"></i>'}, room=user_room)
        os.makedirs(modules_directory_path, exist_ok=True)
        print("ZIP file processed successfully")
        socketio.emit('progress', {'message': 'ZIP file processed successfully! <i class="fa fa-check-circle"></i>'}, room=user_room)
        print("Deleting old files from target directory...")
        socketio.emit('progress', {'message': 'Deleting old files from target directory... <i class="fa fa-spinner fa-spin"></i>'}, room=user_room)
        delete_all_files_in_directory(modules_directory_path)
        print("Old files deleted successfully!")
        socketio.emit('progress', {'message': 'Old files deleted successfully! <i class="fa fa-check-circle"></i>'}, room=user_room)

        saved_files = []
        for zip_file in file_list:
            if zip_file.endswith('.py'):
                extracted_path = os.path.join(modules_directory_path, zip_file)
                os.makedirs(os.path.dirname(extracted_path), exist_ok=True)
                with zip_ref.open(zip_file) as extracted_file, open(extracted_path, 'wb') as f_out:
                    shutil.copyfileobj(extracted_file, f_out)
                saved_files.append(zip_file)
                socketio.emit('progress', {'message': f'Successfully extracted {zip_file} <i class="fa fa-check-circle"></i>'}, room=user_room)

        # parent_directory = os.path.dirname(f"{NEW_DIRECTORY_PATH}/{board_name_id}")
        # os.chdir(parent_directory)

        try:
            socketio.emit('progress', {'message': 'Running the make command for the build... <i class="fa fa-spinner fa-spin"></i>'}, room=user_room)
            create_manifest_file(board_name_id, user_id)
            subprocess.run(
                ['make', f'BOARD={board_name}', f'BUILD={board_name_id}', f'FROZEN_MANIFEST=manifest/manifest_{user_id}.py'],
                cwd='/root/micropython/ports/stm32',
                capture_output=True, text=True, check=True
            )
            print("Successfully built firmware")
            socketio.emit('progress', {'message': f'Successfully built for {board_name}! <i class="fa fa-check-circle"></i>'}, room=user_room)

            # Define the build directory
            build_directory = os.path.join(FIRMWARE_DIRECTORY_PATH, board_name_id)
            
            if os.path.exists(build_directory) and os.path.isdir(build_directory):
                build_files = os.listdir(build_directory)
                # print(f"Files in build directory ({build_directory}): {build_files}")

                # Specify the list of required files
                # required_files = ['firmware0.bin', 'firmware1.bin', 'firmware.hex', 'firmware.dfu']
                required_files = ['firmware.hex', 'firmware.dfu']
                selected_files = [file for file in build_files if file in required_files]

                print(f"Selected files for ZIP: {selected_files}")

                if selected_files:
                    # zip_file_path = os.path.join(build_directory, 'selected_files.zip')
                    socketio.emit('progress', {'message': 'Selected build files (HEX and DFU) found... <i class="fa fa-spinner fa-spin"></i>'}, room=user_room)
                    
                    # with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    #     for file_name in selected_files:
                    #         file_path = os.path.join(build_directory, file_name)

                    #         if os.path.isfile(file_path):
                    #             # Debugging: Log file size before zipping
                    #             original_size = os.path.getsize(file_path)
                    #             print(f"Adding file to ZIP: {file_name}, Size: {original_size} bytes")
                                
                    #             # Ensure the file is fully written and not locked
                    #             with open(file_path, 'rb') as f:
                    #                 file_content = f.read()
                    #                 zip_file.writestr(file_name, file_content)

                    #             # Debugging: Compare size after zipping
                    #             zipped_size = len(file_content)
                    #             print(f"Zipped file: {file_name}, Size: {zipped_size} bytes")
                                
                    #             socketio.emit('progress', {'message': f'Successfully added {file_name} to the ZIP file <i class="fa fa-check-circle"></i>'}, room=user_room)

                    # print("Selected build files successfully packaged into ZIP.")
                    socketio.emit('progress', {'message': 'Selected build files successfully (HEX and DFU) <i class="fa fa-check-circle"></i>'}, room=user_room)
                    return jsonify({
                        "status": "success",
                        # "files": selected_files,
                        "hex_file": f"/download/{board_name_id}/{selected_files[0]}",
                        "dfu_file": f"/download/{board_name_id}/{selected_files[1]}"
                    }), 200
                else:
                    return jsonify({
                        "status": "error",
                        "message": "Required files not found in the build directory"
                    }), 400
            else:
                return jsonify({
                    "status": "error",
                    "message": f"Build directory {board_name_id} not found."
                }), 400

        except subprocess.CalledProcessError as e:
            print(f"Error running make command: {e.stderr}")
            socketio.emit('progress', {'message': f"Error running make command: {e.stderr}"}, room=user_room)
            return jsonify({"status": "error", "message": f"Error running make command: {e.stderr}"}), 400


@app.route('/')
def home():
    username = request.args.get('username')
    if username:
        myuz = ''
        for c in username:
            myuz+=str(ord(c))
        return render_template('index.html', username=myuz)
    else:
        return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_file():
    username = request.form.get('username')  # Retrieve from form data
    if 'build_file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400

    file = request.files['build_file']
    board_name = request.form['board_name']
    firmware_version = request.form['firmware_version']

    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    if file and allowed_file(file.filename):
        user_room = request.form.get('user_room')  # Retrieve the Socket.IO room (sid) from the form
        if user_room:
            # Update firmware version and date in the firmware_info.h file
            firmware_info_path = os.path.join(FIRMWARE_DIRECTORY_PATH, 'firmware_info.h')
            date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            update_firmware_info_file(firmware_info_path, firmware_version, date)
            return process_zip_file(file, board_name, username, user_room)
        else:
            return jsonify({"status": "error", "message": "No user room found"}), 400

    return jsonify({"status": "error", "message": "Only ZIP files are allowed"}), 400


@app.route('/download/<board_name_id>/<filename>')
def download_file(board_name_id, filename):
    file_path = os.path.join(FIRMWARE_DIRECTORY_PATH, board_name_id, filename)
    print(f"Attempting to download from: {file_path}")  # Debugging line
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
    else:
        return jsonify({
            "status": "error",
            "message": f"File not found: {file_path}"
        }), 404

# # Route for the Device tab
@app.route('/device')
def device():
    return render_template('device.html')

# # Route for the Settings tab
# @app.route('/settings')
# def settings():
#     return render_template('settings.html')

# # Route for the field data tab
# @app.route('/field_data')
# def field_data():
#     return render_template('fieldData.html')

# # Route for the DFU tab
# @app.route('/dfu')
# def dfu():
#     return render_template('dfu.html')

# # Route for the Tcpftp tab
# @app.route('/tcpftp')
# def tcpftp():
#     return render_template('tcpftp.html')

# Route for the BUILD tab
# @app.route('/build')
# def build():
#     # Check if 'username' is a query parameter
#     username = request.args.get('username')
#     if username:
#         myuz = ''
#         for c in username:
#             myuz+=str(ord(c))
#         return render_template('build.html', username=myuz)
#     else:
#         return render_template('build.html')


if __name__ == "__main__":
    socketio.run(app, host='0.0.0.0', port=9000, debug=True)