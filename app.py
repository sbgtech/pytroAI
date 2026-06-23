import subprocess, shutil, zipfile, os, time, datetime, re, json
from flask import Flask, render_template, request, send_file, jsonify, redirect, url_for, abort, send_from_directory
from io import BytesIO
from flask_socketio import SocketIO, emit
import eventlet
import serial.tools.list_ports
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
app.secret_key = os.urandom(24) # Set your secret key
socketio = SocketIO(app, cors_allowed_origins="*")
app.config['ALLOWED_EXTENSIONS'] = {'zip'}
socketio = SocketIO(app, manage_session=True)  # Initialize SocketIO with the app
user_rooms = {}

NEW_DIRECTORY_PATH = '/root/micropython/ports/stm32/modules'
FIRMWARE_DIRECTORY_PATH = '/root/micropython/ports/stm32'
STATIC_FILE = "/apps/apps.json"

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

                    # print("Selected build files successfully packaged into ZIP.")
                    socketio.emit('progress', {'message': 'Selected build files successfully (HEX and DFU) <i class="fa fa-check-circle"></i>'}, room=user_room)
                    return jsonify({
                        "status": "success",
                        # "files": selected_files,
                        "hex_file": f"/download/{board_name_id}/{selected_files[0]}",
                        "dfu_file": f"/download/{board_name_id}/{selected_files[1]}",
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

# Function to get image and table path based on product name (board name)
def get_product_info(name):
    image_path = url_for('static', filename=f'images/boards/{name}.png')
    table_path = url_for('get_table', name=name)
    return image_path, table_path

# Serve table HTML file
@app.route('/data_tables/<name>.html')
def get_table(name):
    return send_from_directory('templates/data_tables', f'{name}.html')

# API endpoint to get image/table paths
@app.route('/api/product_info/<name>')
def product_info(name):
    try:
        image_path, table_url = get_product_info(name)
        return jsonify({'image': image_path, 'table_url': table_url})
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/')
def home():
    username = request.args.get('username')
    # with open('apps.json') as f:
    #     data = json.load(f)
    #     print(data)
    return render_template('index.html', username=username)

@app.route('/get-data')
def get_data():
    unitId = request.args.get("macId")
    if not unitId:
        return jsonify({"error": "MAC address required"}), 400

    apps_dir = "apps"
    os.makedirs(apps_dir, exist_ok=True)

    file_path = os.path.join(apps_dir, f"apps_{unitId}.json")
    static_file_path = os.path.join(apps_dir, "apps.json")

    try:
        with open(static_file_path) as f:
            static_data = json.load(f)
            static_apps = static_data.get("apps", [])
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to read static file: {e}"}), 500

    if os.path.exists(file_path):
        with open(file_path) as f:
            unit_data = json.load(f)
            unit_apps = unit_data.get("apps", [])
            unitId_val = unit_data.get("unitId", "")
            board_val = unit_data.get("board", "")
            mmr_metadata = unit_data.get("MMR_METADATA", {})
    else:
        unit_apps = []
        unitId_val = ""
        board_val = ""
        mmr_metadata = {}

    # Convert app lists to dicts for easier merging
    def apps_list_to_dict(apps):
        return {list(app.keys())[0]: app for app in apps}

    static_dict = apps_list_to_dict(static_apps)
    unit_dict = apps_list_to_dict(unit_apps)

    # Merge: Add missing apps from static to unit
    for app_key, app_val in static_dict.items():
        if app_key not in unit_dict:
            unit_dict[app_key] = app_val
        else:
            # Merge app fields (add missing fields from static to unit)
            for field, value in app_val[list(app_val.keys())[0]].items():
                if field not in unit_dict[app_key][list(app_val.keys())[0]]:
                    unit_dict[app_key][list(app_val.keys())[0]][field] = value
                if field == "DESCRIPTION":
                    unit_dict[app_key][list(app_val.keys())[0]][field] = value

    # Remove fields that are no longer in static apps
    for app_key in list(unit_dict.keys()):
        if app_key not in static_dict:
            del unit_dict[app_key]  # Remove app entirely if it no longer exists in static

        else:
            # Check for fields that were removed from static
            for field in list(unit_dict[app_key][list(unit_dict[app_key].keys())[0]].keys()):
                if field not in static_dict[app_key][list(static_dict[app_key].keys())[0]]:
                    del unit_dict[app_key][list(unit_dict[app_key].keys())[0]][field]

    # Convert back to list
    merged_apps = list(unit_dict.values())

    # Save merged file back
    updated_data = {
        "apps": merged_apps,
        "unitId": unitId_val,
        "board": board_val,
        "MMR_METADATA":mmr_metadata
    }
    with open(file_path, "w") as f:
        json.dump(updated_data, f, indent=2)
    return jsonify(updated_data)

@app.route("/update-apps", methods=["POST"])
def update_apps():
    data = request.get_json()
    unitId = data.get("unitId")
    if not data or not unitId:
        return jsonify({"status": "error", "message": "No data or MAC address provided"}), 400
    apps_dir = "apps"
    os.makedirs(apps_dir, exist_ok=True)  # Ensure the directory exists
    file_path = os.path.join(apps_dir, f"apps_{unitId}.json")
    try:
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "success", "message": f"{file_path} updated"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/promote-app-fields", methods=["POST"])
def promote_app_fields():
    data = request.json

    app_key = data["appKey"]                     # PYTRO_RFC
    unit_id = data["unitId"]                     # 028893134283
    field_name = data["field"]["name"]           # PYTRO_RFC_DS_TEST
    field_value = data["field"]["value"]         # "12"

    apps_dir = "apps"
    static_path = os.path.join(apps_dir, "apps.json")
    unit_path = os.path.join(apps_dir, f"apps_{unit_id}.json")

    # ---------- update apps.json ----------
    with open(static_path) as f:
        static_data = json.load(f)

    static_app_found = False
    for app in static_data["apps"]:
        if app_key in app:
            static_app_found = True
            if field_name not in app[app_key]:
                app[app_key][field_name] = field_value
            break

    if not static_app_found:
        return jsonify({"error": "App not found in apps.json"}), 404

    if not field_name.startswith(app_key + "_"):
        return jsonify({"error": "Field does not belong to app"}), 400

    with open(static_path, "w") as f:
        json.dump(static_data, f, indent=2)

    # ---------- update apps_<unitId>.json ----------
    if not os.path.exists(unit_path):
        return jsonify({"error": "Unit apps file not found"}), 404

    with open(unit_path) as f:
        unit_data = json.load(f)

    for app in unit_data.get("apps", []):
        if app_key in app:
            if field_name not in app[app_key]:
                app[app_key][field_name] = field_value
            break

    with open(unit_path, "w") as f:
        json.dump(unit_data, f, indent=2)

    return jsonify({
        "status": "ok",
        "app": app_key,
        "unitId": unit_id,
        "field": field_name
    })

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

@app.route('/api/ports')
def get_ports():
    ports = serial.tools.list_ports.comports()
    ports_list = [{'device': port.device, 'name': port.name, 'description': port.description} for port in ports]
    print(ports_list)

# def read_json():
#     with open('apps.json', 'r') as file:
#         return json.load(file)
    
# Write updated data to the JSON file
# def write_json(data):
#     with open('apps.json', 'w') as file:
#         json.dump(data, file, indent=4)

# Update or modify app settings
# @app.route('/api/apps/<app_name>', methods=['POST'])
# def update_app(app_name):
#     try:
#         updated_data = request.get_json()
#         data = read_json()
#         app_to_update = next((item for item in data["apps"] if app_name in item), None)
#         if not app_to_update:
#             return jsonify({"error": "App not found"}), 404
#         app_to_update[app_name].update(updated_data)
#         write_json(data)
#         return jsonify({"message": "App updated successfully"}), 200
#     except Exception as e:
#         return jsonify({"error": str(e)}), 500

# state = {"enabled": 1, "isAll": 1}

# @app.route("/get_state", methods=["GET"])
# def get_state():
#     return jsonify(state)

# @app.route("/set_state", methods=["POST"])
# def set_state():
#     data = request.get_json()
#     enabled = data.get("enabled")
#     isAll = data.get("isAll")
#     if enabled in [0, 1]:
#         state["enabled"] = enabled
#         state["isAll"] = isAll
#         return jsonify({"status": "updated", "enabled": enabled, "isAll": isAll}), 200
#     return jsonify({"error": "Invalid value"}), 400

if __name__ == "__main__":
    socketio.run(app, host='0.0.0.0', port=9090, debug=True)