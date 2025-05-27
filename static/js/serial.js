// Constants for DFU protocol
const DFU_UPLOAD = 0x02;
const DFU_DNLOAD = 0x01;
const DFU_GETSTATUS = 0x03;
const DFU_CLRSTATUS = 0x04;
const DFU_ABORT = 0x06;
let port; // Global reference to the serial port
let writer; // Global reference to the writable stream
let reader; // Global reference to the readable stream
let captureFiles = false;
let configuration = false;
let Filecheck = false;
let configParameters = {};
let dataBuffer = "";
let refreshConfigForm = false;

let progressDFUItems = [];

let selectedDevice = null;
let dfuFile = null;

const commandHistory = []; // Array to store command history
let historyIndex = -1; // Current index for history navigation

let isFlashChecked = false; // variable that controls the state of flash (true or false)

let renamed_board_name = "";
let isDeviceConnected = false;

/* verify ifrxist a username params in the url */
window.onload = function () {
  const urlParams = new URLSearchParams(window.location.search);
  const username = urlParams.get("username");
  // console.log(username);
  // Get the Send button element
  const sendButton = document.querySelector('button[type="submit"]');

  // Check if the username exists
  if (username && username !== "null") {
    // Enable the button if username exists
    sendButton.disabled = false;
  } else {
    // Disable the button and show an alert if username is missing
    sendButton.disabled = true;
    alert("Username is missing in the URL.");
  }
};

async function resetDFUProcess() {
  document.getElementById("dfu-progress-list").innerHTML = "";
  document.getElementById("dfu-build-progress-list").innerHTML = "";
}

async function DisplayDFUProcess(divID, msg, className) {
  const progressList = document.getElementById(divID);
  progressList.style.listStyleType = "none";
  const listItem = document.createElement("li");
  listItem.textContent = msg;
  listItem.style.fontWeight = "bold";
  listItem.classList.add("alert");
  listItem.classList.add(className);
  progressList.appendChild(listItem);
  progressDFUItems.push(listItem);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setDeviceStatus(text, color) {
  const elements = document.querySelectorAll(".device-status");
  elements.forEach((el) => {
    el.textContent = text;
    el.style.backgroundColor = color;
  });
}

function setBoardName(text) {
  const elements = document.querySelectorAll(".config-form-board-name");
  elements.forEach((el) => {
    el.textContent = text;
  });
}

async function fileSystem() {
  try {
    document.getElementById("fileSystemTable").style.display = "none";
    document.getElementById("fileSystemLoadMessage").style.display = "block";
    document.getElementById("fileSystemLoadMessage").style.textAlign = "center";
    document.getElementById("fileSystemLoadMessageText").textContent =
      "Loading...";
    setTimeout(() => {
      if (isDeviceConnected) {
        document.getElementById("fileSystemLoadMessageText").textContent = "";
        document.getElementById("fileSystemLoadMessage").style.display = "none";
      } else {
        document.getElementById("fileSystemLoadMessageText").textContent =
          "Error to loading the File system, please try to reconnect the device";
      }
    }, 3000);
    captureFiles = true;
    // Python command to get files and sizes and check flash status
    await SerialWrite(
      `\x03\r\nimport pyb\r\print(pyb.usb_mode()+'FLASH')\r\nimport os\r\nprint([(f, os.stat(f)[6]) for f in os.listdir() if os.stat(f)[0] == 32768])\r\n`
    );
    const inputField = document.getElementById("serial-input");
    inputField.disabled = false;
    inputField.placeholder = "Input your commands here...";
  } catch (err) {
    console.error("FileSystem function error:", err);
  }
}

function uploadToForm() {
  // Create a file input element dynamically
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json"; // Specify acceptable file type

  // Handle file selection
  fileInput.onchange = async (event) => {
    const file = event.target.files[0];

    if (file) {
      console.log("Selected file:", file.name);

      try {
        // Read the JSON file
        const reader = new FileReader();
        // Asynchronously handle the file reading and populating the form
        reader.onload = async (fileEvent) => {
          const jsonData = JSON.parse(fileEvent.target.result);
          /* get all ids and values for the existing inputs */
          const form = document.getElementById("dynamicConfigForm");
          const inputs = form.querySelectorAll("input, select");
          inputs.forEach((input) => {
            const id = input.id;
            const value = jsonData[id];
            if (value === undefined) return;
            if (input.type === "checkbox") {
              input.checked = value === "ON";
            } else if (input.tagName === "SELECT") {
              if (Array.isArray(value)) {
                const firstValue = value[0];
                Array.from(input.options).forEach((option) => {
                  option.selected = option.value === firstValue;
                });
              } else {
                input.value = value;
              }
            } else {
              input.value = value;
            }
          });
        };
        // Read the file content as text
        reader.readAsText(file);
      } catch (error) {
        console.error("Error reading or parsing the JSON file:", error);
        alert("Failed to process the file.");
      }
    }
  };

  // Trigger the file input dialog
  fileInput.click();
}

function saveDataToJSON() {
  /* get all ids and values for the existing inputs */
  const form = document.getElementById("dynamicConfigForm");
  const inputs = form.querySelectorAll("input, select");
  const inputDetails = {};
  inputs.forEach((input) => {
    const id = input.id;
    if (input.type === "checkbox") {
      inputDetails[id] = input.checked ? "ON" : "OFF";
    } else if (input.tagName === "SELECT") {
      // For select elements, get all options
      const options = Array.from(input.options);
      const selectedValue = input.value; // Get the selected value
      const optionValues = [
        selectedValue,
        ...options
          .filter((option) => option.value !== selectedValue)
          .map((option) => option.value),
      ];
      inputDetails[id] = optionValues; // Store all options with the selected one first
    } else {
      const value = input.value;
      inputDetails[id] = value;
    }
  });
  // Convert the data object into a JSON string
  const jsonData = JSON.stringify(inputDetails, null, 2);
  // Create a Blob object with the JSON string
  const blob = new Blob([jsonData], { type: "application/json" });
  // Create a link element to trigger the download
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "data.json"; // Specify the filename for the download
  // Trigger the download by simulating a click on the link
  link.click();
  // Optionally, revoke the object URL after download
  URL.revokeObjectURL(link.href);
}

async function configForm() {
  try {
    document.getElementById("configFormDataContainer").style.display = "none";
    document.querySelectorAll(".loadMessageContainer").forEach((button) => {
      button.style.display = "flex";
    });
    document.querySelectorAll(".reconnect-btn").forEach((button) => {
      button.style.display = "none";
    });
    document.querySelectorAll(".loadMessageText").forEach((text) => {
      text.textContent = "Loading...";
    });
    setTimeout(() => {
      if (isDeviceConnected) {
        document.querySelectorAll(".loadMessageText").forEach((text) => {
          text.textContent = "";
        });
        document.querySelectorAll(".loadMessageContainer").forEach((button) => {
          button.style.display = "none";
        });
      } else {
        document.querySelectorAll(".loadMessageText").forEach((text) => {
          text.textContent =
            "Error to loading, please try to reconnect the device";
        });
        document.querySelectorAll(".reconnect-btn").forEach((button) => {
          button.style.display = "block";
        });
      }
    }, 2000);
    Filecheck = true;
    await SerialWrite(
      `\x03\r\nprint(f"<>{machine.board_name()}<>")\r\nimport os\r\nprint('CONFIG1' if 'config.py' in os.listdir() else 'CONFIG0')\r\n`
    );
    const inputField = document.getElementById("serial-input");
    inputField.disabled = false;
    inputField.placeholder = "Input your commands here...";
  } catch (err) {
    console.error("Config Form error:", err);
  }
}

function reconnectAndReloadConfig() {
  refreshConfigForm = true;
  SerialMonitor();
}

async function applyConfig(event) {
  event.preventDefault(); // Prevent the form from submitting and the page from refreshing
  /* get all ids and values for the existing inputs */
  const form = document.getElementById("dynamicConfigForm");
  const inputs = form.querySelectorAll("input, select");
  const inputDetails = {};
  inputs.forEach((input) => {
    const id = input.id;
    if (input.type === "checkbox") {
      inputDetails[id] = input.checked ? "ON" : "OFF";
    } else if (input.tagName === "SELECT") {
      // For select elements, get all options
      const options = Array.from(input.options);
      const selectedValue = input.value; // Get the selected value
      const optionValues = [
        selectedValue,
        ...options
          .filter((option) => option.value !== selectedValue)
          .map((option) => option.value),
      ];
      inputDetails[id] = optionValues; // Store all options with the selected one first
    } else {
      const value = input.value;
      inputDetails[id] = value;
    }
  });
  console.log("first ", inputDetails);

  // Convert data into the desired format
  let formattedData = "";
  for (let [key, value] of Object.entries(inputDetails)) {
    if (typeof value === "object") {
      const arrayString = JSON.stringify(value).replace(/"/g, "'");
      formattedData += `${key} = ${arrayString}\\r\\n`;
    } else if (value.trim() === "") {
      formattedData += `${key} = ''\\r\\n`;
    } else {
      formattedData += `${key} = '${value}'\\r\\n`;
    }
  }

  // Log the formatted data
  console.log(formattedData);
  await StopScript();
  await sleep(100);
  try {
    await SerialWrite(
      `import os\r\nos.remove('config.py')\r\nf=open('config.py','w')\r\nf.write('''${formattedData}''')\r\nf.close()\r\n`
    );
  } catch (err) {
    console.error("Error updating config.py:", err);
  }
  await configForm();
  document.getElementById("popup").textContent = "Form Saved Successfully";
  showPopup("#208f5b");
}

function generateForm(config) {
  document.getElementById("configFormDataContainer").style.display = "block";
  document.querySelectorAll(".loadMessageContainer").forEach((button) => {
    button.style.display = "none";
  });
  const form = document.getElementById("dynamicConfigForm");
  form.innerHTML = "";

  for (const [key, value] of Object.entries(config)) {
    // create the row tag
    const row = document.createElement("div");
    row.classList.add("row", "align-items-center", "mb-4");

    // create col div for each label & input
    const labelCol = document.createElement("div");
    labelCol.classList.add("col-12", "col-sm-6", "col-md-4");
    const inputCol = document.createElement("div");
    inputCol.classList.add("col-12", "col-sm-6", "col-md-4");

    const label = document.createElement("label");
    const labelName = key.replaceAll("_", " ");
    label.setAttribute("for", key);
    label.textContent = labelName;
    if (value === "ON" || value === "OFF") {
      inputCol.classList.add("form-switch");
      // formGroup.style.paddingLeft = "0px";
      // label.style.flex = "0 0 55%";
    }
    // label.style.flex = "0 0 50%";
    labelCol.appendChild(label);

    if (Array.isArray(value)) {
      // Generate select input if value is an array
      const select = document.createElement("select");
      select.setAttribute("id", key);
      select.setAttribute("name", key);
      select.classList.add("form-select");
      value.forEach((optionValue) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        select.appendChild(option);
      });
      inputCol.appendChild(select);
    } else if (value === "ON" || value === "OFF") {
      // Generate checkbox if value is ON/OFF
      const checkbox = document.createElement("input");
      checkbox.setAttribute("type", "checkbox");
      checkbox.setAttribute("id", key);
      checkbox.setAttribute("name", key);
      checkbox.classList.add("form-check-input");
      checkbox.style.width = "32px";
      checkbox.style.height = "16px";
      checkbox.style.marginLeft = "-20px";
      if (value === "ON") {
        checkbox.setAttribute("checked", "checked");
      }
      inputCol.appendChild(checkbox);
    } else {
      // Generate text input for other types
      const input = document.createElement("input");
      input.setAttribute("type", "text");
      input.setAttribute("id", key);
      input.setAttribute("name", key);
      input.setAttribute("value", value);
      input.classList.add("form-control");
      inputCol.appendChild(input);
    }
    row.appendChild(labelCol);
    row.appendChild(inputCol);
    form.appendChild(row);
  }

  // Add submit button
  // const buttonRow = document.createElement("div");
  // buttonRow.classList.add(
  //   "d-flex",
  //   "align-items-center",
  //   "justify-content-end"
  // );
  // const submitButton = document.createElement("button");
  // submitButton.setAttribute("type", "button");
  // submitButton.textContent = "Apply";
  // submitButton.setAttribute("onclick", "applyConfig(event)");
  // submitButton.classList.add("btn", "btn-dark");
  // submitButton.style.width = "10%";
  // buttonRow.appendChild(submitButton);
  // form.appendChild(buttonRow);
}

function displayNewFieldModal() {
  document.getElementById("modal").style.display = "flex"; // Show the modal
}

function hideNewFieldModal() {
  document.getElementById("modal").style.display = "none"; // Hide the modal
}

function prefixWithPytro(input) {
  const prefix = "PYTRO_";
  let rawValue = input.value;

  // Ensure the value starts with "PYTRO_" but don't remove it
  if (!rawValue.startsWith(prefix)) {
    input.value = prefix; // Set it back to "PYTRO_" if it gets deleted
    return;
  }

  // Always strip the prefix first for processing
  let valueWithoutPrefix = rawValue.slice(prefix.length);

  // Remove disallowed characters (letters, numbers, underscores, spaces)
  valueWithoutPrefix = valueWithoutPrefix.replace(/[^a-zA-Z0-9 _]/g, "");

  // Replace spaces with underscores
  valueWithoutPrefix = valueWithoutPrefix.replace(/\s+/g, "_");

  // Remove multiple underscores (e.g., "__" -> "_")
  valueWithoutPrefix = valueWithoutPrefix.replace(/_+/g, "_");

  // Convert to uppercase
  valueWithoutPrefix = valueWithoutPrefix.toUpperCase();

  // Set final value with the "PYTRO_" prefix
  input.value = prefix + valueWithoutPrefix;
}

function handleTypeChange(selectElement) {
  const selectedValue = selectElement.value;
  // Show a modal based on selected option
  if (selectedValue === "TEXT") {
    document.getElementById("addOptionsBlock").style.display = "none";
    document.getElementById("addCheckboxBlock").style.display = "none";
    document.getElementById("addInputBlock").style.display = "block";
  } else if (selectedValue === "SELECT") {
    document.getElementById("addInputBlock").style.display = "none";
    document.getElementById("addCheckboxBlock").style.display = "none";
    document.getElementById("addOptionsBlock").style.display = "block";
  } else {
    console.log("CHECKBOX");
    document.getElementById("addInputBlock").style.display = "none";
    document.getElementById("addOptionsBlock").style.display = "none";
    document.getElementById("addCheckboxBlock").style.display = "block";
  }
}

function addOptionInput(plusIcon) {
  const wrapper = document.getElementById("optionsWrapper");

  // Turn the previous icon into a minus
  if (plusIcon) {
    plusIcon.classList.remove("fa-plus");
    plusIcon.classList.add("fa-minus");
    plusIcon.onclick = function () {
      removeOptionInput(plusIcon.parentElement);
    };
  }

  // Create new row
  const row = document.createElement("div");
  row.className = "d-flex align-items-center custom-gap mb-2";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control";
  input.oninput = function () {
    optionToUppercase(input);
  };

  const icon = document.createElement("i");
  icon.className = "fa fa-plus";
  icon.style.cursor = "pointer";
  icon.onclick = function () {
    addOptionInput(icon);
  };

  row.appendChild(input);
  row.appendChild(icon);
  wrapper.appendChild(row);
}

function removeOptionInput(rowElement) {
  rowElement.remove();

  // After removing, make sure the last row has a plus icon
  const wrapper = document.getElementById("optionsWrapper");
  const rows = wrapper.querySelectorAll("div");

  if (rows.length > 0) {
    rows.forEach((row, index) => {
      const icon = row.querySelector("i");
      icon.classList.remove("fa-plus", "fa-minus");

      if (index === rows.length - 1) {
        // Last row: make it a plus
        icon.classList.add("fa-plus");
        icon.onclick = function () {
          addOptionInput(icon);
        };
      } else {
        // Others: make it a minus
        icon.classList.add("fa-minus");
        icon.onclick = function () {
          removeOptionInput(row);
        };
      }
    });
  }
}

function optionToUppercase(input) {
  input.value = input.value.toUpperCase();
}

function saveNewField() {
  const type = document.getElementById("typeSelect").value;
  const paramName = document.getElementById("label_name").value.trim();
  const formContainer = document.getElementById("dynamicConfigForm");
  const inputs = formContainer.querySelectorAll("input, select");
  let paramExists = false;
  inputs.forEach((input) => {
    if (paramName === input.id) {
      paramExists = true;
    }
  });
  if (paramExists) {
    document.getElementById("popup").textContent = "Parameter Already Exists";
    showPopup("rgba(0, 0, 0, 0.8)");
  }
  let result = {
    label: paramName,
    type: type,
    value: null,
  };
  if (!paramExists) {
    // create the row tag
    const row = document.createElement("div");
    row.classList.add("row", "align-items-center", "mb-4");

    // create col div for each label & input
    const labelCol = document.createElement("div");
    labelCol.classList.add("col-12", "col-sm-6", "col-md-4");
    const inputCol = document.createElement("div");
    inputCol.classList.add("col-12", "col-sm-6", "col-md-4");

    // Add label
    const label = document.createElement("label");
    const labelName = paramName.replaceAll("_", " ");
    label.setAttribute("for", paramName);
    label.textContent = labelName;
    labelCol.appendChild(label);

    if (type === "TEXT") {
      const textValue = document.getElementById("value_name").value.trim();
      const input = document.createElement("input");
      input.setAttribute("type", "text");
      input.setAttribute("id", paramName);
      input.setAttribute("value", textValue);
      input.classList.add("form-control");
      inputCol.appendChild(input);
      result.value = textValue;
    } else if (type === "SELECT") {
      const options = [];
      const optionInputs = document
        .getElementById("optionsWrapper")
        .querySelectorAll("input");
      const select = document.createElement("select");
      select.setAttribute("id", paramName);
      select.classList.add("form-select");
      optionInputs.forEach((input) => {
        const val = input.value.trim();
        if (val) {
          options.push(val);
          const option = document.createElement("option");
          option.textContent = val;
          option.value = val;
          select.appendChild(option);
        }
      });
      inputCol.appendChild(select);
      result.value = options;
    } else if (type === "CHECKBOX") {
      const checkboxValue = document.getElementById("checkbox_value").checked;
      const checkbox = document.createElement("input");
      checkbox.setAttribute("type", "checkbox");
      checkbox.setAttribute("id", paramName);
      checkbox.checked = checkboxValue;
      checkbox.classList.add("form-check-input");
      checkbox.style.width = "32px";
      checkbox.style.height = "16px";
      checkbox.style.marginLeft = "-20px";
      inputCol.appendChild(checkbox);
      result.value = checkboxValue;
    }
    row.appendChild(labelCol);
    row.appendChild(inputCol);
    formContainer.appendChild(row);
    console.log("Collected field data:", result);
    hideNewFieldModal();
  }
}

async function SerialCom(tab) {
  try {
    await resetDFUProcess();
    if (reader) {
      reader.releaseLock();
    }
    if (port) {
      await port.close();
      port = null;
    }
    port = await navigator.serial.requestPort();
    if (tab === "dfu") {
      document.getElementById("dfu-container").style.display = "block";
      document.getElementById("dfu-loading").style.display = "block";
      document.getElementById("dfu-loadingMessage").textContent =
        "Set to Bootloader mode, please wait...";
    } else {
      document.getElementById("build-progress-list").style.display = "none";
      document.getElementById("dfu-build-container").style.display = "block";
      document.getElementById("dfu-build-loading").style.display = "block";
      document.getElementById("dfu-build-loadingMessage").textContent =
        "Set to Bootloader mode, please wait...";
    }
    // Open the serial port with the desired settings
    await port.open({ baudRate: 9600 });
    console.log("Serial port opened:", port);
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Serial port opened",
      "alert-info"
    );
    const encoder = new TextEncoder();
    writer = port.writable.getWriter();
    //Send Ctrl + C to stop any running code, import pyb and call pyb.bootloader()
    const ctrlC = encoder.encode("\x03\r\nimport pyb\r\npyb.bootloader()\r\n"); // Bootloader command
    await writer.write(ctrlC);
    console.log("Sent DFU command");
    // Close the writer after sending commands
    writer.releaseLock();
    await port.close();
    port = null;
    // Wait for 3 seconds before enabling the DFU Process button
    // const dfuButton = document.getElementById("dfuProcessButton");
    setTimeout(async () => {
      if (tab === "dfu") {
        document.getElementById("dfu-loading").style.display = "none";
        console.log("DFU mode enabled. You may proceed to the next step");
        document.getElementById("selectDeviceButton").disabled = false;
      } else {
        document.getElementById("dfu-build-loading").style.display = "none";
        document.getElementById("selectDeviceButtonBuildDFU").disabled = false;
        document.getElementById("uploadToDeviceBtn").disabled = true;
      }
      await resetDFUProcess();
      await DisplayDFUProcess(
        tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
        "DFU mode enabled. You may proceed to the next step.",
        "alert-success"
      );
      setDeviceStatus("Bootloader mode", "#FF9800");
      isDeviceConnected = false;
    }, 3000);
  } catch (err) {
    tab === "dfu"
      ? (document.getElementById("dfu-loading").style.display = "none")
      : (document.getElementById("dfu-build-loading").style.display = "none");
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Failed to communicate with the serial port",
      "alert-danger"
    );
  }
}

function getFileImage(fileName) {
  // Extract the file extension
  const extension = fileName.split(".").pop().toLowerCase(); // Get the extension and convert to lowercase

  // Map file extensions to image URLs
  const imageMap = {
    py: "static/images/python.png",
    json: "static/images/json.png",
    txt: "static/images/txt.png",
    default: "images/default.jpg",
  };

  // Return the appropriate image URL based on the extension
  return imageMap[extension] || imageMap["default"];
}

function getFileType(extension) {
  const typeMap = {
    py: "Python",
    json: "JSON",
    txt: "Text",
    default: "Unknown",
  };
  return typeMap[extension] || typeMap["default"];
}

function getSizeOfKey(key) {
  const value = localStorage.getItem(key); // Get the value for the key
  if (value !== null) {
    // Calculate size of the key and value in UTF-16 (2 bytes per character)
    const totalSize = key.length + value.length;
    const sizeInBytes = totalSize * 2; // Multiply by 2 for UTF-16 encoding
    // Convert bytes to megabytes (MB)
    // const sizeInMB = sizeInBytes / (1024 * 1024); // 1 MB = 1024 * 1024 bytes
    return sizeInBytes;
  } else {
    return 0; // If the key does not exist
  }
}

// let previousParsedData = {};

// Function to parse data between <CLEAR> and <END>
// function parseDataBlock(rawData) {
//   const regex =
//     /<CLEAR>[\s\S]*?===============================([\s\S]*?)===============================/;
//   const match = rawData.match(regex);

//   if (!match) {
//     console.log("No valid <CLEAR> data block found.");
//     return null;
//   }

//   const block = match[1].trim();
//   const lines = block
//     .split("\n")
//     .map((line) => line.trim())
//     .filter((line) => line);

//   const parsed = {};

//   lines.forEach((line) => {
//     const [label, value] = line.split(/\s{2,}/); // Split on 2+ spaces
//     if (label && value) {
//       parsed[label] = value;
//     }
//   });
//   console.log(parsed);
//   return parsed;
// }

// Function to simulate incoming data and update the parsed data
// function updateParsedData(newRawData) {
//   const newParsed = parseDataBlock(newRawData);
//   if (!newParsed) return;
//   let hasChanges = false;
//   // Check for updated or new keys
//   for (const [key, newValue] of Object.entries(newParsed)) {
//     if (previousParsedData[key] !== newValue) {
//       previousParsedData[key] = newValue;
//       hasChanges = true;
//     }
//   }
//   // Optionally, check for removed keys
//   for (const key of Object.keys(previousParsedData)) {
//     if (!(key in newParsed)) {
//       delete previousParsedData[key];
//       hasChanges = true;
//     }
//   }
//   if (hasChanges) {
//     console.log("🔄 Updated JSON:");
//     console.log(JSON.stringify(previousParsedData, null, 2));
//   } else {
//     console.log("✅ No changes detected.");
//   }
// }

async function SerialMonitor() {
  try {
    // Request access to the serial port
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    console.log("Serial port opened:", port.getInfo());
    const textArea = document.getElementById("serial-output");
    setDeviceStatus("Device Connected", "#439a43");
    document.getElementById("deviceInfoContainer").style.display = "flex";
    isDeviceConnected = true;
    document.querySelectorAll(".console-buttons").forEach((button) => {
      button.disabled = false;
    });
    if (refreshConfigForm) {
      document.querySelectorAll(".reconnect-btn").forEach((button) => {
        button.style.display = "none";
      });
      document.querySelectorAll(".loadMessageText").forEach((text) => {
        text.textContent = "Please Click On Refresh";
      });
    }

    await StopScript();
    await SerialWrite(`\x03\r\nprint(f"<>{machine.board_name()}<>")\r\n`);
    await RunScript();
    // Set up a reader to continuously read from the serial port
    const decoder = new TextDecoder();
    reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Reader has been closed
          break;
        }
        if (value) {
          const Serialdata = decoder.decode(value);
          console.log(
            `Size of terminal: ${
              new TextEncoder().encode(textArea.textContent).length
            } bytes`
          );
          // Check if the text content size exceeds 100KB (102,400 bytes)
          if (new TextEncoder().encode(textArea.textContent).length > 102400) {
            console.log("Clearing terminal...");
            const content = textArea.textContent;
            let existingLogs = localStorage.getItem("logs");
            if (existingLogs) {
              const logsSize = getSizeOfKey("logs");
              console.log(`Size of 'logs' key: ${logsSize} bytes`);
              // Check if the local storage size exceeds 300KB (307,200 bytes)
              if (logsSize > 307200) {
                console.log(`Restarted Logs in localStorage`);
                localStorage.setItem("logs", "");
                existingLogs = content;
              } else {
                existingLogs += "\n" + content;
              }
            } else {
              existingLogs = content;
            }
            localStorage.setItem("logs", existingLogs);
            clearTerminal();
          }
          textArea.textContent += Serialdata;
          textArea.scrollTop = textArea.scrollHeight; // Auto-scroll to the bottom
          // const clearmatch = textArea.textContent.match(/<CLEAR>/);
          // if (clearmatch) {
          // console.log("clear appeared");
          // let content = textArea.textContent;
          // content = updateParsedData(content);
          // let existingLogs = localStorage.getItem("logs");
          // if (existingLogs) {
          //   existingLogs += "\n" + content;
          // } else {
          //   existingLogs = content;
          // }
          // localStorage.setItem("logs", existingLogs);
          // const logsSize = getSizeOfKey("logs");
          // console.log(`Size of 'logs' key: ${logsSize} MB`);
          // setTimeout(() => {
          //   clearTerminal();
          // }, 900);
          // }
          //check board name
          const namematch = textArea.textContent.match(/<>[A-Za-z][^<>]*<>/);
          if (namematch) {
            // Extract the matched portion and clean it up
            // console.log("NAME EXTRACTED:", namematch[0].slice(2, -2));
            const BOARD_Name = namematch[0].slice(2, -2);
            renamed_board_name = BOARD_Name.replace(/ /g, "_");
            setBoardName(renamed_board_name);
            // Fetch product info from Flask
            // fetch(`/api/product_info/${renamed}`)
            //   .then((res) => res.json())
            //   .then((data) => {
            //     if (data.error) {
            //       throw new Error(data.error);
            //     }
            //     // console.log(data);
            //     // Set image
            //     document.getElementById("boardImage").src = data.image;
            //     // Load and insert table HTML
            //     return fetch(data.table_url);
            //   })
            //   .then((res) => res.text())
            //   .then((html) => {
            //     document.getElementById("tableContainer").innerHTML = html;
            //   })
            //   .catch((err) => {
            //     document.getElementById(
            //       "tableContainer"
            //     ).innerHTML = `<p style="color:red;">${err.message}</p>`;
            //   });
          }
          // Check flash status
          if (
            Serialdata.includes("VCPFLASH") ||
            Serialdata.includes("VCP+MSCFLASH")
          ) {
            if (Serialdata.includes("VCP+MSCFLASH")) {
              isFlashChecked = true;
              const flashCheckbox = document.getElementById("flashCheckbox");
              flashCheckbox.checked = isFlashChecked;
              console.log("FLASH ENABLED");
            } else {
              isFlashChecked = false;
              const flashCheckbox = document.getElementById("flashCheckbox");
              flashCheckbox.checked = isFlashChecked;
              console.log("FLASH DSIABLED");
            }
          }
          if (captureFiles) {
            dataBuffer += Serialdata;
            // Match a valid list of tuples[('file1.txt', 123), ('file2.log', 456)]
            const match = dataBuffer.match(
              /\[\(('.*?', \d+)(?:, \('.*?', \d+\))*\)\]/
            );
            if (match) {
              // Extract the matched portion and clean it up
              console.log(" Data before Cleaning:", match[0]);
              const cleanedData = match[0]
                .replace(/'/g, '"') // Replace single quotes with double quotes
                .replace(/\(/g, "[") // Replace opening tuple with opening array
                .replace(/\)/g, "]"); // Replace closing tuple with closing array
              console.log("Cleaned Data:", cleanedData);
              fileList = JSON.parse(cleanedData);
              console.log("Files list:", fileList);
              document.getElementById("fileSystemLoadMessage").style.display =
                "none";
              document.getElementById("fileSystemTable").style.display =
                "block";
              document.getElementById("fileSystemContainerTable").style.height =
                "100%";
              document.getElementById(
                "fileSystemContainerTable"
              ).style.overflowY = "scroll";
              const filesListContainer = document.getElementById("filesList");
              filesListContainer.innerHTML = "";
              fileList.forEach((file) => {
                const fileName = file[0]; // First element of each array (file name)
                const fileSize = file[1]; // Second element (file size)
                const totalFileSize = fileSize / 1024;
                const calcfileSize =
                  fileSize / 1024 < 1
                    ? "1 KB"
                    : `${totalFileSize.toFixed(2)} KB`;
                // Create a new table row
                const row = document.createElement("tr");

                // Create table cells for each file property
                const imageCell = document.createElement("td");
                const imageSrc = getFileImage(fileName);
                imageCell.innerHTML = `<img src="${imageSrc}" alt="File icon" width="30" height="30">`;
                row.appendChild(imageCell);

                const fileCell = document.createElement("td");
                fileCell.textContent = fileName;
                row.appendChild(fileCell);

                const typeCell = document.createElement("td");
                const fileExtension = fileName.split(".").pop().toLowerCase();
                const fileType = getFileType(fileExtension);
                typeCell.textContent = fileType;
                row.appendChild(typeCell);

                const sizeCell = document.createElement("td");
                sizeCell.textContent = calcfileSize;
                row.appendChild(sizeCell);

                // Append the row to the table body
                filesListContainer.appendChild(row);
              });
              captureFiles = false; // Stop capturing after extracting the list
              dataBuffer = ""; // Clear the buffer after processing
            }
          }
          if (Filecheck) {
            dataBuffer += Serialdata;
            let match = dataBuffer.match(/(CONFIG0|CONFIG1)(?!')/);
            if (match) {
              Filecheck = false;
              dataBuffer = "";
              console.log(match[0]);
              if (match[0] == "CONFIG1") {
                configuration = true;
                // Python command to get config parameters from file
                await SerialWrite(
                  `\x03\r\nf=open('config.py')\r\nprint("=-={}=-=".format(f.read()))\r\n`
                );
              }
              if (match[0] == "CONFIG0") {
                configuration = true;
                // Python command to get config parameters from module
                await SerialWrite(
                  `\x03\r\nimport config\r\nprint("=-=\n{}=-=".format("\n".join([f"{attribute} = {getattr(config, attribute)}" if isinstance(getattr(config, attribute), list) else f"{attribute} = '{getattr(config, attribute)}'" for attribute in dir(config) if attribute.startswith('PYTRO_')])))\r\n`
                );
              }
            }
          }
          if (configuration) {
            dataBuffer += Serialdata;
            // console.log("CONFIG DATA BUFFER :", dataBuffer);
            const match = dataBuffer.match(/=-=([\s\S]*)=-=/);
            if (match) {
              // Extract the matched portion and clean it up
              // console.log("DATA EXTRACTED:", match[0]);
              const contentBetweenQuotes = match[0]; // Extract content between quotes
              // Check if the content matches the key-value pair pattern
              const pattern =
                /(PYTRO_\w+)\s*=\s*(\d+|'[^']+'|\[\s*'[^']+'\s*(?:,\s*'[^']+'\s*)*\])\s*/g;
              const keyValueMatches = [
                ...contentBetweenQuotes.matchAll(pattern),
              ];
              // If the content contains key-value pairs, process it
              if (keyValueMatches.length > 4) {
                // console.log("CONTENT BETWEEN QUOTES:", contentBetweenQuotes);
                // Loop through matches and extract the key-value pairs
                keyValueMatches.forEach((matchData) => {
                  const key = matchData[1].trim(); // Extract key (e.g., 'key1')
                  const value = matchData[2].trim(); // Extract value (e.g., 'value1')
                  if (key && value) {
                    // Clean up the key and value, and store them
                    const TreatedVal = value.replace(/^'(.*)'$/, "$1");
                    if (TreatedVal[0] == "[") {
                      configParameters[key] = JSON.parse(
                        value
                          .replace(/'/g, '"')
                          .replace(/\s+/g, "")
                          .replace(/,\]/g, "]")
                      );
                    } else {
                      configParameters[key] = TreatedVal;
                    }
                  }
                });
                console.log("DATA AFTER CLEANING:", configParameters);
                fetch("/get-data")
                  .then((res) => res.json())
                  .then((data) => {
                    const storeContainer = document.getElementById(
                      "apps-store-container"
                    );
                    const installedContainer = document.getElementById(
                      "apps-installed-container"
                    );
                    // Render board info
                    const boardInfo = `
                        <h6>Board Name : <strong>${renamed_board_name}</strong></h6>
                        <h6>Board ID : <strong>${data.UNITID}</strong></h6>
                      `;
                    storeContainer.innerHTML = boardInfo;
                    installedContainer.innerHTML = boardInfo;
                    let rowsHTML = "";
                    data.apps.forEach((appObj) => {
                      const appKey = Object.keys(appObj)[0]; // e.g., "PYTRO_CELL"
                      const appData = appObj[appKey];
                      const name = appData.NAME || appKey;
                      const description =
                        appData.DESCRIPTION || "Description Not Available";
                      const publisher =
                        appData.PUBLISHER || "Publisher Not Available";
                      const category =
                        appData.CATEGORY || "Category Not Available";
                      const size = appData.SIZE
                        ? `${appData.SIZE} MB`
                        : "Size Not Available";
                      // const is_enabled = appData[`${appKey}_ENABLE`];
                      const enableField = appKey + "_ENABLE";

                      // Loop through configParameters keys and update appData if key matches
                      for (const configKey in configParameters) {
                        if (configParameters.hasOwnProperty(configKey)) {
                          // If the config key starts with the appKey + "_" (like PYTRO_BLE_ENABLE)
                          if (configKey.startsWith(appKey + "_")) {
                            // Overwrite or add this key in appData
                            appData[configKey] = configParameters[configKey];
                          }
                        }
                      }

                      const appHTML = `
                        <div class="d-flex flex-column flex-md-row justify-content-md-between store-apps-border gap-3 gap-md-0">
                          <div class="d-flex gap-4 flex-85">
                            <div>
                              <i class="fa fa-terminal terminal-icon" aria-hidden="true"
                                style="background-color: #efefef; font-weight: bold; padding-inline: 12px; padding-block: 9px; font-size: 20px; border-radius: 4px;">
                              </i>
                            </div>
                            <div>
                              <h5>${appKey.replaceAll("_", " ")}</h5>
                              <span>${description}</span>
                              <div class="d-flex flex-column flex-md-row gap-0 gap-md-5 mt-2">
                                <span style="color: gray; font-size: 12px">${publisher}</span>
                                <span style="color: gray; font-size: 12px">${category}</span>
                                <span style="color: gray; font-size: 12px">${size}</span>
                              </div>
                            </div>
                          </div>
                          <div class="d-flex align-items-center flex-15">
                          ${
                            appData[enableField].toUpperCase() === "ON"
                              ? `<button class="btn btn-success w-100 disabled">
                              <i class="fa fa-check" aria-hidden="true"></i> Installed
                            </button>`
                              : `<button class="btn btn-primary w-100" onclick="installApp('${appKey}')">
                              <i class="fa fa-download" aria-hidden="true"></i> Install
                            </button>`
                          }
                            
                          </div>
                        </div>
                      `;
                      storeContainer.innerHTML += appHTML;

                      const icons = document.querySelectorAll(".terminal-icon");
                      icons.forEach(function (icon) {
                        icon.style.color = getRandomColor();
                      });

                      if (
                        appData[enableField] &&
                        appData[enableField].toUpperCase() === "ON"
                      ) {
                        rowsHTML += `
                          <tr>
                            <td class="fw-medium">${name}</td>
                            <td>${size}</td>
                            <td>${category}</td>
                            <td><span class="status-running">Running</span></td>
                            <td>
                              <div class="d-flex flex-column justify-content-center flex-md-row gap-2">
                                <button class="btn btn-primary" onclick="editApp('${appKey}')"><i class="fa fa-pencil-square-o" aria-hidden="true"></i> Edit</button>
                                <button class="btn btn-danger stop-app-button" onclick="stopApp('${appKey}')"><i class="fa fa-stop" aria-hidden="true"></i> Stop</button>
                                <button class="btn btn-secondary" onclick="stopApp('${appKey}')"><i class="fa fa-trash" aria-hidden="true"></i> Uninstall</button>
                              </div>
                            </td>
                          </tr>
                        `;
                      }
                    });
                    if (!rowsHTML) {
                      rowsHTML = `<tr><td colspan="5" class="text-center">No apps enabled.</td></tr>`;
                    }
                    const tableHTML = `
                      <div class="table-responsive">
                        <table class="table table-hover apps-table">
                          <thead class="table-light">
                            <tr>
                              <th scope="col">Name</th>
                              <th scope="col">Size</th>
                              <th scope="col">Category</th>
                              <th scope="col">Status</th>
                              <th scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${rowsHTML}
                          </tbody>
                        </table>
                      </div>
                    `;
                    installedContainer.innerHTML += tableHTML;
                    fetch("/update-apps", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        apps: data.apps,
                        UNITID: data.UNITID,
                        BOARD: renamed_board_name,
                      }),
                    })
                      .then((res) => res.json())
                      .then((result) => {
                        console.log("Server response:", result);
                      })
                      .catch((err) => {
                        console.error("Error sending updated apps.json:", err);
                      });

                    dataBuffer = ""; // Clear buffer after processing
                    configuration = false; // Stop capturing after configuration is updated
                    configParameters = {};
                    console.log("Done CLEANING:", configParameters);
                  })
                  .catch((err) => {
                    console.error("Error fetching apps data:", err);
                    document.getElementById(
                      "apps-installed-container"
                    ).innerHTML =
                      "<span class='d-flex justify-content-center'>Failed to load data.</span>";
                    document.getElementById("apps-store-container").innerHTML =
                      "<span class='d-flex justify-content-center'>Failed to load data.</span>";
                  });

                // After extracting the configuration, update the form display
                generateForm(configParameters);
                document
                  .querySelectorAll(".configForm-buttons")
                  .forEach((button) => {
                    button.style.display = "block";
                  });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Error while reading from the serial port:", err);
      setDeviceStatus("Device Disconnected", "#e34c5a");
      isDeviceConnected = false;
      document.getElementById("popup").textContent = err;
      showPopup("rgba(0, 0, 0, 0.8)");
      document.querySelectorAll(".console-buttons").forEach((button) => {
        button.disabled = true;
      });
      document.getElementById("configFormDataContainer").style.display = "none";
      document.querySelectorAll(".configForm-buttons").forEach((button) => {
        button.style.display = "none";
      });
      setBoardName("(Not connected)");
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    console.error("Failed to communicate with the serial port:", err);
    setDeviceStatus("Device Disconnected", "#e34c5a");
    isDeviceConnected = false;
    document.getElementById("popup").textContent = err;
    showPopup("rgba(0, 0, 0, 0.8)");
    document.querySelectorAll(".console-buttons").forEach((button) => {
      button.disabled = true;
    });
    document.getElementById("configFormDataContainer").style.display = "none";
    document.querySelectorAll(".configForm-buttons").forEach((button) => {
      button.style.display = "none";
    });
    setBoardName("(Not connected)");
  }
}

async function saveToConfigFile(mergedConfig) {
  let formattedApps = "";
  for (let [key, value] of Object.entries(mergedConfig)) {
    if (typeof value === "object") {
      const arrayString = JSON.stringify(value).replace(/"/g, "'");
      formattedApps += `${key} = ${arrayString}\\r\\n`;
    } else if (value.trim() === "") {
      formattedApps += `${key} = ''\\r\\n`;
    } else {
      formattedApps += `${key} = '${value}'\\r\\n`;
    }
  }
  await StopScript();
  await sleep(100);
  try {
    await SerialWrite(
      `import os\r\nos.remove('config.py')\r\nf=open('config.py','w')\r\nf.write('''${formattedApps}''')\r\nf.close()\r\n`
    );
  } catch (err) {
    console.error("Error updating config.py:", err);
  }
  await configForm();
}

function mergedToConfig(mergedConfig, data) {
  data.apps.forEach((app) => {
    const [appName, config] = Object.entries(app)[0];
    Object.entries(config).forEach(([key, value]) => {
      if (key.startsWith("PYTRO_")) {
        mergedConfig[key] = value;
      }
    });
  });
}

// edit app fields
function editApp(appKey) {
  document.getElementById("editAppsModal").style.display = "flex";
  fetch("/get-data")
    .then((response) => response.json())
    .then((data) => {
      const apps = data.apps;
      const app = apps.find((item) => item.hasOwnProperty(appKey));

      if (!app) {
        document.getElementById(
          "editAppContainer"
        ).innerHTML = `<p class="text-danger">App "${appKey}" not found.</p>`;
        return;
      }
      document.getElementById(
        "editAppTitle"
      ).innerHTML = `<span class="app-key-highlight">${appKey.replaceAll(
        "_",
        " "
      )} </span> Application`;
      const fields = app[appKey];
      const formFields = [];

      for (const [key, value] of Object.entries(fields)) {
        let inputHtml = "";

        if (key.startsWith(appKey + "_") && key !== `${appKey}_ENABLE`) {
          const labelName = key.replaceAll("_", " ");
          if (Array.isArray(value)) {
            // Dropdown for arrays
            inputHtml = `<select class="form-select flex-50" name="${key}" id="${key}">
            ${value
              .map((opt) => `<option value="${opt}">${opt}</option>`)
              .join("")}
          </select>`;
          } else if (
            typeof value === "boolean" ||
            value === "ON" ||
            value === "OFF"
          ) {
            // Toggle for ON/OFF
            inputHtml = `<select class="form-select flex-50" name="${key}" id="${key}">
            <option value="ON" ${value === "ON" ? "selected" : ""}>ON</option>
            <option value="OFF" ${
              value === "OFF" ? "selected" : ""
            }>OFF</option>
          </select>`;
          } else {
            // Text input
            inputHtml = `<input type="text" class="form-control flex-50" name="${key}" id="${key}" value="${value}">`;
          }

          formFields.push(`
          <div class="mb-3 d-flex justify-content-between align-items-center">
            <label class="flex-50 text-start">${labelName}</label>
            ${inputHtml}
          </div>
        `);
        }
      }
      formFields.push(`
        <div class="d-flex justify-content-end gap-2">
          <button onclick="hideEditAppsModal()" class="btn btn-dark">
            Cancel
          </button>
          <button class="btn btn-success" onclick="saveAppChanges()">
            Submit
          </button>
        </div>
      `);
      let formHtml = `
        <div class="mb-3 d-flex justify-content-between align-items-center">
          <input type="hidden" id="editAppKey" value="${appKey}" />
        </div>
        ${
          formFields.length > 1
            ? formFields.join("")
            : `<p class="text-danger fw-bold">No editable fields available for this application.</p>`
        }
      `;

      document.getElementById("editAppForm").innerHTML = formHtml;
    })
    .catch((err) => {
      console.error("Error loading data:", err);
      document.getElementById(
        "editAppContainer"
      ).innerHTML = `<p class="text-danger">Error loading Application.</p>`;
    });
}

// save app changes
function saveAppChanges() {
  const formContainer = document.getElementById("editAppForm");
  const inputs = formContainer.querySelectorAll("input, select, textarea");
  const appKey = document.getElementById("editAppKey")?.value;
  const updatedData = {};
  const mergedConfig = {};

  if (!appKey) {
    document.getElementById("popup").textContent = "Application is missing";
    showPopup("rgba(205, 9, 9, 0.8)");
    return;
  }

  fetch("/get-data")
    .then((res) => res.json())
    .then((data) => {
      const appIndex = data.apps.findIndex((app) => app.hasOwnProperty(appKey));
      if (appIndex === -1) {
        document.getElementById("popup").textContent = "Application not found";
        showPopup("rgba(205, 9, 9, 0.8)");
        return;
      }
      const originalApp = data.apps[appIndex][appKey];

      inputs.forEach((input) => {
        const key = input.name;
        let value = input.value;

        if (!key || key.trim() === "") return;

        // Convert ON/OFF to uppercase consistently
        if (value.toUpperCase() === "ON" || value.toUpperCase() === "OFF") {
          value = value.toUpperCase();
        }

        const originalValue = originalApp[key];

        // 🔁 Handle array-like fields where first item is selected
        if (Array.isArray(originalValue)) {
          const rest = originalValue.filter((v) => v !== value);
          updatedData[key] = [value, ...rest];
        } else {
          updatedData[key] = value;
        }
      });

      data.apps[appIndex] = {
        [appKey]: {
          ...data.apps[appIndex][appKey], // original values
          ...updatedData, // updated from form
        },
      };
      mergedToConfig(mergedConfig, data);
      return fetch("/update-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apps: data.apps,
          UNITID: data.UNITID,
          BOARD: renamed_board_name,
        }),
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then(() => {
      document.getElementById("popup").textContent =
        "Application saved successfully";
      showPopup("#208f5b");
      hideEditAppsModal();
      saveToConfigFile(mergedConfig);
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("popup").textContent = "Error saving changes";
      showPopup("rgba(205, 9, 9, 0.8)");
    });
}

// hide the edit app modal
function hideEditAppsModal() {
  document.getElementById("editAppsModal").style.display = "none";
}

function showCustomConfirm() {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    modal.style.display = "block";

    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");

    const cleanup = () => {
      modal.style.display = "none";
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
    };

    const onYes = () => {
      cleanup();
      resolve(true);
    };

    const onNo = () => {
      cleanup();
      resolve(false);
    };

    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
  });
}

// stop app
async function stopApp(appKey) {
  const confirmed = await showCustomConfirm();
  if (!confirmed) return;
  const enableKey = appKey + "_ENABLE";
  const updatedData = {};
  const mergedConfig = {};
  if (!appKey) {
    document.getElementById("popup").textContent = "Application is missing";
    showPopup("rgba(205, 9, 9, 0.8)");
    return;
  }
  fetch("/get-data")
    .then((res) => res.json())
    .then((data) => {
      const appIndex = data.apps.findIndex((app) => app.hasOwnProperty(appKey));
      if (appIndex === -1) {
        document.getElementById("popup").textContent = "Application not found";
        showPopup("rgba(205, 9, 9, 0.8)");
        return;
      }
      const originalApp = data.apps[appIndex][appKey];
      updatedData[enableKey] = "OFF";
      data.apps[appIndex] = {
        [appKey]: {
          ...originalApp, // original values
          ...updatedData, // updated from form
        },
      };
      mergedToConfig(mergedConfig, data);
      return fetch("/update-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apps: data.apps,
          UNITID: data.UNITID,
          BOARD: renamed_board_name,
        }),
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then(() => {
      document.getElementById("popup").textContent =
        "Application successfully uninstalled";
      showPopup("#208f5b");
      saveToConfigFile(mergedConfig);
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("popup").textContent = "Error saving changes";
      showPopup("rgba(205, 9, 9, 0.8)");
    });
}

// install app from store
function installApp(appKey) {
  const mergedConfig = {};
  fetch("/get-data")
    .then((res) => res.json())
    .then((data) => {
      const appIndex = data.apps.findIndex((app) => app.hasOwnProperty(appKey));
      // Check if the app exists
      if (appIndex === -1) {
        document.getElementById(
          "popup"
        ).textContent = `The app ${appKey} not found.`;
        showPopup("rgba(205, 9, 9, 0.8)");
        return;
      }
      // Get the app object
      const app = data.apps[appIndex][appKey];
      if (app) {
        app[`${appKey}_ENABLE`] = "ON"; // Update the _ENABLE field to "ON"
        console.log(`Set ${appKey}_ENABLE to ON`);
        mergedToConfig(mergedConfig, data);
        // Save the updated data back (assuming a POST request to save it)
        return fetch("/update-apps", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apps: data.apps,
            UNITID: data.UNITID,
            BOARD: renamed_board_name,
          }),
        });
      } else {
        document.getElementById(
          "popup"
        ).textContent = `The app ${appKey} not found.`;
        showPopup("rgba(205, 9, 9, 0.8)");
      }
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then((resData) => {
      console.log("App updated successfully:", resData);
      document.getElementById("popup").textContent =
        "Application successfully installed";
      showPopup("#208f5b");
      saveToConfigFile(mergedConfig);
    })
    .catch((err) => {
      console.error(err);
    });
}

async function downloadLogs() {
  const savedLogs = localStorage.getItem("logs");
  try {
    if (savedLogs) {
      // Request the file handle from the user
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: "logs.txt", // Suggested filename
        types: [
          {
            description: "Text Files",
            accept: { "text/plain": [".txt"] },
          },
        ],
      });
      // Create a writable stream to write to the file
      const writableStream = await fileHandle.createWritable();
      // Write the content to the file
      await writableStream.write(savedLogs);
      // Close the writable stream to save the file
      await writableStream.close();
      document.getElementById("popup").textContent = "File saved successfully";
      showPopup("rgba(4, 217, 114, 0.75)");
      console.log("File saved successfully");
    } else {
      document.getElementById("popup").textContent = "No Logs Saved Yet.";
      showPopup("rgba(205, 9, 9, 0.8)");
    }
  } catch (err) {
    document.getElementById("popup").textContent = err;
    showPopup("rgba(205, 9, 9, 0.8)");
    console.error("Error saving file:", err);
  }
}

function clearTerminal() {
  const textArea = document.getElementById("serial-output");
  if (textArea) {
    textArea.textContent = ""; // Clear the content of the text area
  }
}

async function SerialWrite(cmd) {
  try {
    writer = port.writable.getWriter();
    const encoder = new TextEncoder();
    const command = encoder.encode(cmd); // ASCII for command
    await writer.write(command);
    writer.releaseLock();
  } catch (err) {
    console.error(`Failed to send ${cmd}:`, err);
  }
}

async function MachineReset() {
  try {
    await StopScript();
    await sleep(100);
    // Python command to reset
    await SerialWrite(`import machine\r\nmachine.reset()\r\n`);
  } catch (err) {
    console.error("FileSystem function error:", err);
  }
}

async function restartDevice(tab) {
  try {
    if (port) {
      await port.close();
      port = null;
    }
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    await StopScript();
    await sleep(100);
    // Python command to reset
    await SerialWrite(`import machine\r\nmachine.reset()\r\n`);
    await port.close();
    port = null;
    await resetDFUProcess();
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Successfully restarting device ✅",
      "alert-success"
    );
    if (tab === "build") {
      document.getElementById("restartDeviceBuildButton").disabled = true;
      document.getElementById("uploadToDeviceBtn").disabled = false;
    }
  } catch (err) {
    console.error("FileSystem function error:", err);
  }
}

async function RunScript() {
  try {
    await SerialWrite("\x04");
    const inputField = document.getElementById("serial-input");
    inputField.disabled = true;
    inputField.placeholder = "Stop the run to input your command";
  } catch (err) {
    console.error(err);
  }
}

async function StopScript() {
  try {
    await SerialWrite("\x03");
    const inputField = document.getElementById("serial-input");
    inputField.disabled = false;
    inputField.placeholder = "Input your commands here...";
  } catch (err) {
    console.error(err);
  }
}

async function handleFlash(event) {
  const isChecked = event.target.checked;
  const input = isChecked ? 1 : 0;
  console.log("Flash is now", input);
  try {
    // Python command to enable flash
    await SerialWrite(`\x03\r\nimport pyflash\r\npyflash.enable(${input})\r\n`);
  } catch (err) {
    console.error("Flash function error:", err);
  }
}

async function SendSerialInput(event) {
  const inputField = document.getElementById("serial-input");

  if (!inputField) {
    console.error("Element with ID 'serial-input' not found");
    return;
  }

  if (event.key === "Enter") {
    try {
      const command = inputField.value.trim(); // Get the trimmed input value

      if (!command) {
        console.warn("Input is empty. Nothing to send.");
        return;
      }

      if (!port || !port.writable) {
        console.error("Serial port is not open for writing.");
        return;
      }

      // Check if the command already exists in history
      const existingIndex = commandHistory.indexOf(command);
      if (existingIndex !== -1) {
        // Remove the command from its current position
        commandHistory.splice(existingIndex, 1);
      }
      // Save the command to the end of history
      commandHistory.push(command);
      historyIndex = commandHistory.length; // Reset history index to the latest

      await SerialWrite(command + "\r\n"); // Send the command to serial
      inputField.value = ""; // Clear the input field after sending
    } catch (err) {
      console.error("Failed to send user input:", err);
    }
  } else if (event.key === "ArrowUp") {
    // Navigate to the previous command in history
    if (historyIndex > 0) {
      historyIndex--;
      inputField.value = commandHistory[historyIndex];
    }
  } else if (event.key === "ArrowDown") {
    // Navigate to the next command in history
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      inputField.value = commandHistory[historyIndex];
    } else if (historyIndex === commandHistory.length - 1) {
      // If already at the latest command, clear the input field
      historyIndex = commandHistory.length;
      inputField.value = "";
    }
  }
}

async function selectUSBDevice() {
  try {
    // Request USB device selection from the user
    await resetDFUProcess();
    await DisplayDFUProcess(
      "dfu-progress-list",
      "Connecting to device...",
      "alert-info"
    );
    selectedDevice = await navigator.usb.requestDevice({ filters: [] });
    // Ensure the selected device is the expected one
    if (selectedDevice.productName === "STM32  BOOTLOADER") {
      console.log("Device selected:", selectedDevice);
      // Enable the DFU process button
      document.getElementById("UpgradeFirmwareButton").disabled = false;
      await resetDFUProcess();
      await DisplayDFUProcess(
        "dfu-progress-list",
        "Connected to Device, Ready for Firmware Upgrade ✅",
        "alert-success"
      );
    } else {
      console.log("Selected device does not match the desired product name.");
      selectedDevice = null;
    }
  } catch (error) {
    console.error("Error selecting USB device:", error);
    selectedDevice = null;
  }
}

async function getFileFromUrl(url, fileName) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type });
}

async function selectedDfuFile() {
  try {
    // Request USB device selection from the user
    await resetDFUProcess();
    await DisplayDFUProcess(
      "dfu-build-progress-list",
      "Connecting to device...",
      "alert-info"
    );
    selectedDevice = await navigator.usb.requestDevice({ filters: [] });
    // Ensure the selected device is the expected one
    if (selectedDevice.productName === "STM32  BOOTLOADER") {
      await resetDFUProcess();
      await DisplayDFUProcess(
        "dfu-build-progress-list",
        "Connected to Device, Ready for Firmware Upgrade ✅",
        "alert-success"
      );
      const dfuFileObj = await getFileFromUrl(dfuFile, "firmware.dfu");
      if (dfuFileObj) {
        console.log("DFU File as File object:", dfuFileObj);
        console.log("File name:", dfuFileObj.name);
        // Proceed with the DFU file processing
        await selectedDevice.open();
        console.log("Device opened:", selectedDevice);
        if (selectedDevice.configuration === null)
          await selectedDevice.selectConfiguration(1);
        await selectedDevice.claimInterface(0);
        console.log("Interface claimed");
        await DFU("build", dfuFileObj, selectedDevice);
      }
    } else {
      console.log("Selected device does not match the desired product name.");
      selectedDevice = null;
    }
  } catch (error) {
    console.error("Error selecting USB device:", error);
    selectedDevice = null;
  }
}

async function startDFUProcess() {
  try {
    if (!selectedDevice) {
      console.error("No USB device selected. Please select a device first.");
      return;
    }
    // Immediately trigger the file dialog
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".dfu"; // Specify acceptable file types
    fileInput.onchange = async (event) => {
      const file = event.target.files[0];
      if (file) {
        console.log("Selected file:", file.name);
        // Proceed with the DFU file processing
        await selectedDevice.open();
        console.log("Device opened:", selectedDevice);
        if (selectedDevice.configuration === null)
          await selectedDevice.selectConfiguration(1);
        await selectedDevice.claimInterface(0);
        console.log("Interface claimed");
        await DFU("dfu", file, selectedDevice);
      }
    };
    // Trigger the file input dialog
    fileInput.click();
  } catch (error) {
    console.error("Error during DFU process:", error);
  }
}

async function DFU(tab, file, device) {
  let flag = await Mass_Erase(tab, device);
  if (flag == true) {
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Mass Erase Successful ✅",
      "alert-info"
    );
  } else {
    alert("Error occurred during Mass Erase");
    tab === "dfu"
      ? (document.getElementById("dfu-loading").style.display = "none")
      : (document.getElementById("dfu-build-loading").style.display = "none");
    await resetDFUProcess();
    return;
  }
  flag = await parseDfuFile(tab, file, device);
  if (flag == true) {
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Firmware updated successfully ✅",
      "alert-info"
    );
  } else {
    alert("Error occurred during Firmware update");
    tab === "dfu"
      ? (document.getElementById("dfu-loading").style.display = "none")
      : (document.getElementById("dfu-build-loading").style.display = "none");
    await resetDFUProcess();
    return;
  }
  flag = await Leave_DFU(device);
  if (flag == true) {
    await resetDFUProcess();
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Firmware updated successfully ✅, please restart the device",
      "alert-success"
    );
    setDeviceStatus("Device Disconnected", "#e34c5a");
    isDeviceConnected = false;
    tab === "dfu"
      ? ((document.getElementById("dfu-loading").style.display = "none"),
        (document.getElementById("restartDeviceDFUButton").disabled = false))
      : ((document.getElementById("dfu-build-loading").style.display = "none"),
        (document.getElementById("selectDeviceButtonBuildDFU").disabled = true),
        (document.getElementById("restartDeviceBuildButton").disabled = false));
  } else {
    alert("Error occurred during Restart");
    tab === "dfu"
      ? (document.getElementById("dfu-loading").style.display = "none")
      : (document.getElementById("dfu-build-loading").style.display = "none");
    await resetDFUProcess();
    return;
  }
}

async function getStatus(device) {
  try {
    // Perform a control transfer to get the DFU status
    const result = await device.controlTransferIn(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_GETSTATUS,
        value: 0,
        index: 0, // Interface index
      },
      6 // Expecting a 6-byte status response
    );

    if (result.status !== "ok") {
      throw new Error(`Error during control transfer: ${result.status}`);
    }

    if (result.data) {
      const statusData = new Uint8Array(result.data.buffer);
      console.log("DFU Status:", statusData[4]); // Log the 5th byte of the result
      return statusData[4]; // Return the status byte
    } else {
      throw new Error("No data received from DFU status request.");
    }
  } catch (error) {
    console.error("Error getting DFU status:", error.message);
    throw error;
  }
}

// Function to clear DFU error status
async function clearStatus(device) {
  try {
    // Perform a control transfer to clear the DFU status
    const result = await device.controlTransferOut(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_CLRSTATUS,
        value: 0,
        index: 0, // Interface index
      },
      new ArrayBuffer(0) // No additional data required
    );

    if (result.status === "ok") {
      console.log("DFU status cleared successfully!");
    } else {
      console.error("Failed to clear DFU status. Status:", result.status);
    }
  } catch (error) {
    console.error("Error in clearing DFU status:", error.message);
  }
}

// Function to clear DFU error status
async function returnToIdle(device) {
  try {
    // Perform a control transfer to clear the DFU status
    const result = await device.controlTransferOut(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_ABORT,
        value: 0,
        index: 0, // Interface index
      },
      new ArrayBuffer(0) // No additional data required
    );

    if (result.status === "ok") {
      console.log("Returned to Idle successfully!");
    } else {
      console.error("Failed to return to Idle. Status:", result.status);
    }
  } catch (error) {
    console.error("Error in returning to Idle:", error.message);
  }
}

//Function to handle faults and ensure the device is in dfuIDLE state
async function handleFaults(device, retries = 5, delay = 500) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      let status = await getStatus(device);

      if (!status) {
        console.log("Failed to get status, retrying...");
        await sleep(delay);
        continue;
      }

      // Check if the device is in dfuIDLE state (0x02)
      if (status === 0x02) {
        console.log("Device is in dfuIDLE state.");
        return true; // Device is in dfuIDLE, no further action needed
      }

      // If the device is in dfuERROR (0x0A), clear the error
      if (status === 0x0a) {
        console.log("Device is in dfuERROR state, attempting to clear...");
        await clearStatus(device);

        status = await getStatus(device);
        if (status === 0x02) {
          console.log("Error cleared, device is now in dfuIDLE state.");
          return true;
        } else {
          console.log("Failed to clear dfuERROR state.");
        }
      }

      // If the device is in any other state, attempt to return to dfuIDLE
      console.log(
        `Device is in state ${status}, attempting to return to IDLE...`
      );
      await returnToIdle(device);
      await sleep(delay); // Wait before checking the status again

      status = await getStatus(device);
      if (status === 0x02) {
        console.log("Successfully returned to dfuIDLE state.");
        return true; // Device is in dfuIDLE
      }
    } catch (error) {
      console.error(`Error handling faults: ${error.message}`);
    }

    console.log("Retrying to handle faults...");
    await sleep(delay); // Wait before the next retry
  }

  console.log("Failed to get device to dfuIDLE state after multiple retries.");
  return false; // Return false if the device could not be stabilized
}

// Function to set address pointer
async function setAddressPointer(device, address) {
  try {
    // Create the command array with 0x21 followed by the 4 bytes of the address
    const addrPointerCmd = new Uint8Array(5);
    addrPointerCmd[0] = 0x21;
    for (let i = 0; i < 4; i++) {
      addrPointerCmd[i + 1] = (address >> (i * 8)) & 0xff;
    }

    console.log(
      `Setting address pointer to 0x${address.toString(16).padStart(8, "0")}`
    );

    // Send DFU_DNLOAD request with wValue = 0 to set the address pointer
    const result = await device.controlTransferOut(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_DNLOAD,
        value: 0,
        index: 0, // Interface index
      },
      addrPointerCmd.buffer // Send the address pointer command as ArrayBuffer
    );

    if (result.status === "ok") {
      console.log(
        `Successfully set address pointer to 0x${address
          .toString(16)
          .padStart(8, "0")}`
      );
      return true;
    } else {
      console.error("Failed to set address pointer. Status:", result.status);
      return false;
    }
  } catch (error) {
    console.error("Error setting address pointer:", error.message);
    return false;
  }
}

// Function to perform Mass Erase
async function Mass_Erase(tab, device) {
  try {
    // Ensure device is in dfuIDLE state before proceeding
    const isIdle = await handleFaults(device);
    if (isIdle) {
      console.log(
        "Device is ready in dfuIDLE state. Proceeding with DFU operations..."
      );
    } else {
      console.error(
        "Failed to stabilize the device in dfuIDLE state. Exiting..."
      );
      return false;
    }
    // Command for mass erase
    const eraseCmd = new Uint8Array([0x41]);
    console.log("Sending mass erase command...");
    // Send DFU_DNLOAD request with wValue = 0 and the mass erase command
    const result = await device.controlTransferOut(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_DNLOAD,
        value: 0,
        index: 0, // Interface index
      },
      eraseCmd.buffer
    );
    if (result.status !== "ok") {
      throw new Error("Failed to send erase command.");
    }
    console.log("Erase command sent successfully.");
    // Check status after initiating the erase command
    const status = await getStatus(device);
    if (!status) {
      throw new Error("Failed to retrieve status after sending erase command.");
    }
    if (tab === "dfu") {
      document.getElementById("dfu-loading").style.display = "block";
      document.getElementById("dfu-loadingMessage").textContent =
        "Updating Firmware, please wait...";
    } else {
      document.getElementById("dfu-build-loading").style.display = "block";
      document.getElementById("dfu-build-loadingMessage").textContent =
        "Updating Firmware, please wait...";
    }

    // Wait for the mass erase to complete (14 seconds)
    for (let i = 0; i < 14; i++) {
      console.log(`Erasing... (${i + 1}/14 seconds elapsed)`);
      await DisplayDFUProcess(
        tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
        `Mass Erase in progress ... ${i}/14`,
        "alert-info"
      );
      await sleep(1000); // Wait for 1 second per iteration
      resetDFUProcess();
    }
    // Ensure device is back in dfuIDLE state after erasing
    const eraseSuccess = await handleFaults(device);
    if (eraseSuccess) {
      console.log("Mass Erase Successful.");
      return true;
    } else {
      console.error("Failed to stabilize the device after Mass Erase.");
      return false;
    }
  } catch (error) {
    console.error("Error during Mass Erase:", error.message);
    return false;
  }
}

// Function to Leave DFU
async function Leave_DFU(device) {
  try {
    console.log("restarting device");
    // Set address pointer to 0x08000000
    await setAddressPointer(device, 0x08000000);

    // Get status twice as per DFU specification
    await getStatus(device);
    await getStatus(device);

    // Send DFU_DNLOAD request with wValue = 0 and an empty data buffer
    const result = await device.controlTransferOut(
      {
        requestType: "class",
        recipient: "interface",
        request: DFU_DNLOAD,
        value: 0,
        index: 0, // Interface index
      },
      new ArrayBuffer(0) // No data payload
    );

    // Check the result of the control transfer
    if (result.status === "ok") {
      console.log("Leave DFU command sent successfully.");
    } else {
      console.error("Failed to send Leave DFU command. Status:", result.status);
      return false;
    }
    await getStatus(device);
    return true;
  } catch (error) {
    console.error("Error Leaving DFU:", error.message);
    return false;
  }
}

async function parseDfuFile(tab, file, device) {
  // Read the file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  let offset = 0;

  // Parse DfuSe prefix (11 bytes)
  const dfuPrefix = data.slice(offset, offset + 11);
  offset += 11;
  if (
    !(
      dfuPrefix[0] === 0x44 &&
      dfuPrefix[1] === 0x66 &&
      dfuPrefix[2] === 0x75 &&
      dfuPrefix[3] === 0x53 &&
      dfuPrefix[4] === 0x65 &&
      dfuPrefix[5] === 0x01
    )
  ) {
    throw new Error("Invalid DfuSe signature or unsupported version.");
  }

  // Number of targets
  const bTargets = dfuPrefix[10];
  console.log(`File contains ${bTargets} DFU images`);
  await DisplayDFUProcess(
    tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
    "Parsing firmware file...",
    "alert-info"
  );

  for (let image = 1; image <= bTargets; image++) {
    console.log(`Parsing DFU image ${image}`);

    // Parse target prefix (274 bytes)
    const targetPrefix = data.slice(offset, offset + 274);
    offset += 274;

    // Check for 'Target' signature
    const targetSignature = new TextDecoder().decode(targetPrefix.slice(0, 6));
    if (targetSignature !== "Target") {
      throw new Error("No valid target signature.");
    }

    // Alternate setting and target name
    const bAlternateSetting = targetPrefix[6];
    const targetName = new TextDecoder().decode(
      targetPrefix.slice(11).subarray(0, targetPrefix.indexOf(0x00, 11) - 11)
    );
    console.log(`Target name: ${targetName}`);
    console.log(`Image for alternate setting ${bAlternateSetting}`);

    // Number of elements and total image size
    const dwNbElements = new DataView(targetPrefix.buffer).getUint32(270, true);
    const totalSize = new DataView(targetPrefix.buffer).getUint32(266, true);
    console.log(`(${dwNbElements} elements, total size = ${totalSize})`);
    await DisplayDFUProcess(
      tab === "dfu" ? "dfu-progress-list" : "dfu-build-progress-list",
      "Updating firmware...",
      "alert-info"
    );
    for (let element = 1; element <= dwNbElements; element++) {
      // Parse element header (8 bytes)
      const elementHeader = data.slice(offset, offset + 8);
      offset += 8;

      // Element address and size
      let dwElementAddress = new DataView(elementHeader.buffer).getUint32(
        0,
        true
      );
      let dwElementSize = new DataView(elementHeader.buffer).getUint32(4, true);
      console.log(
        `Parsing element ${element}, address = 0x${dwElementAddress
          .toString(16)
          .padStart(8, "0")}, size = ${dwElementSize}`
      );

      // Extract the element data
      const elementData = data.slice(offset, offset + dwElementSize);
      offset += dwElementSize;
      console.log(
        `Element ${element} data length: ${elementData.length} bytes`
      );
      for (let i = 0; i < elementData.length; i += 2048) {
        try {
          console.log("Writing Firmware...");

          // Set the address pointer
          await setAddressPointer(device, dwElementAddress);

          // Get status twice as per DFU specification
          let status = await getStatus(device);
          status = await getStatus(device);

          // Prepare the firmware chunk to send
          let chunk = elementData.slice(i, i + 2048);

          try {
            const result = await device.controlTransferOut(
              {
                requestType: "class",
                recipient: "interface",
                request: DFU_DNLOAD, // This should be a defined constant, e.g., 0x01
                value: 2, // This is the block number in DFU
                index: 0, // Interface index
              },
              chunk
            );

            console.log(
              "Chunk written successfully:",
              result.bytesWritten,
              "bytes"
            );
          } catch (error) {
            console.error("Error sending download command:", error.message);
            return false; // Exit the loop on error
          }

          // Get status again to verify the device state
          status = await getStatus(device);
          status = await getStatus(device);

          if (!status || status !== 0x05) {
            console.log("Error occurred, stopping firmware upload.");
            return false;
          }

          // Increment the address for the next chunk
          dwElementAddress += 2048;
        } catch (error) {
          console.error("Error during firmware upload:", error.message);
          return false;
        }
      }
    }
    return true;
  }
  console.log("Done parsing DfuSe file.");
}

/* resize terminal */
const row = document.getElementById("deviceInfoContainer");
const resizeHandle = document.getElementById("resizeHandle");
const card = document.getElementById("resizeCmd");
const terminalContainer = document.getElementById("terminalContainer");
let isResizing = false;
// const minWidth = 500; // Minimum width (500px)

// Get the available width of the parent row
function getMinWidth() {
  return row.clientWidth / 2; // Get the full width of the row (container)
}
// Get the available width of the parent row
function getMaxWidth() {
  return row.clientWidth; // Get the full width of the row (container)
}
function widenTerminal() {
  const maxWidth = getMaxWidth();
  card.style.width = `${maxWidth}px`;
}
function minimizeTerminal() {
  const minWidth = getMinWidth();
  card.style.width = `${minWidth}px`;
}

// Show the resize handle only when the mouse is near the left edge
card.addEventListener("mousemove", (e) => {
  const cardRect = card.getBoundingClientRect();
  const mouseX = e.clientX;

  // Check if mouse is within 5px of the left edge of the card
  if (mouseX <= cardRect.left + 5 && mouseX >= cardRect.left - 5) {
    resizeHandle.style.display = "block"; // Show the resize handle
  } else {
    resizeHandle.style.display = "none"; // Hide the resize handle
  }
});

// Mouse down event to start resizing
resizeHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  isResizing = true;
  document.body.style.cursor = "ew-resize"; // Change cursor to indicate resizing
});

// Mouse move event to resize the container
document.addEventListener("mousemove", (e) => {
  if (isResizing) {
    // Get the maxWidth dynamically based on the current row width
    const maxWidth = getMaxWidth();
    const minWidth = getMinWidth();

    // Calculate the width based on the mouse position relative to the left edge
    let newWidth = terminalContainer.getBoundingClientRect().right - e.clientX; // width based on mouse position

    // Constrain the width between minWidth and maxWidth
    if (newWidth < minWidth) newWidth = minWidth;
    if (newWidth > maxWidth) newWidth = maxWidth;

    // Update the width of the card
    card.style.width = newWidth + "px";
  }
});

// Mouse up event to stop resizing
document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = "default"; // Reset cursor to default
  }
});

/* the build section for build process */
// Initialize the SocketIO client
const socket = io("https://msg.s2c.io", {
  transports: ["websocket"],
  path: "/socket.io/", // Ensure the path matches Nginx configuration
  reconnection: true,
  reconnectionAttempts: 5, // Number of reconnection attempts
  reconnectionDelay: 1000, // Delay between attempts (in ms)
  timeout: 20000, // Adjust timeout if needed
});

// Array to store references to list items
const progressItems = [];

// Store the session ID (sid) on the client side
let userRoom = null;

// When the user connects, store their SID (session ID)
socket.on("connect", function () {
  console.log("Connected with socket ID:", socket.id);
  // Set the value of the existing input field
  const socketInput = document.getElementById("userRoom");
  if (socketInput) {
    socketInput.value = socket.id; // Update the hidden input with the socket ID
  } else {
    console.error("userRoom input not found in the form.");
  }
});
// Remove existing listener if present
// socket.off("progress");
// Listen for progress updates from the server
socket.on("progress", function (data) {
  const progressList = document.getElementById("build-progress-list");

  const result = document.getElementById("build-result");
  result.style.display = "block";

  // Create a new <li> element for the progress update
  const listItem = document.createElement("li");
  //listItem.textContent = data.message;
  // Use insertAdjacentHTML to parse the HTML properly
  listItem.insertAdjacentHTML("beforeend", data.message); // Insert as HTML, not plain text

  // listItem.style.fontWeight = "bold";
  // listItem.classList.add("alert");
  // listItem.classList.add("alert-success");

  // Append the <li> element to the list
  progressList.appendChild(listItem);

  // Save the reference to the new <li> element
  progressItems.push(listItem);

  // Scroll to the bottom of the progress list
  progressList.scrollTop = progressList.scrollHeight;

  // Check if the message is 'in progress'
  if (data.message.includes("...")) {
    // If in progress, let's keep it visible
    listItem.style.display = "block";
  }

  // Check if the message is 'successfully' processed
  if (
    data.message.includes("Successfully") ||
    data.message.includes("successfully")
  ) {
    // After showing "successfully", hide the "in progress" message
    progressItems.forEach((item) => {
      if (item.textContent.includes("...")) {
        item.style.display = "none"; // Hide the in-progress item
      }
    });
    // Show the "successfully" message
    listItem.style.display = "block"; // Ensure the success message is visible
    listItem.style.fontWeight = "bold";
  }
});

// Show the loading spinner when the form is submitted
document
  .getElementById("uploadFormBuild")
  .addEventListener("submit", async function (event) {
    event.preventDefault(); // Prevent the default form submission

    // Ensure the hidden input contains the user room
    const socketInput = document.getElementById("userRoom");
    if (!socketInput.value) {
      console.error("Socket ID (user room) is missing!");
      return;
    }

    // Reset the progress and error containers before new upload
    resetUI();

    // Show the loading spinner
    document.getElementById("build-loading").style.display = "block";

    // Show the progress container to display the progress messages
    document.getElementById("build-progress-container").style.display = "block";
    document.getElementById("build-progress-list").style.display = "block";

    // Create a FormData object from the form
    const formData = new FormData(this);

    // Add userRoom (SID) to the form data
    formData.append("user_room", socketInput.value);

    try {
      // Send the form data via AJAX
      const response = await fetch(uploadFileUrl, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.status === "success") {
        // Display the success message and download link
        document.getElementById("build-result-container").style.display =
          "block";
        document.getElementById("download-link-hex").href = data.hex_file;
        document.getElementById("download-link-dfu").href = data.dfu_file;
        dfuFile = data.dfu_file;
        document.getElementById("build-loading").style.display = "none";
        // document.getElementById("build-progress-list").style.display = "none";
      } else {
        document.getElementById("build-result").style.display = "block";
        document.getElementById("build-error-message").textContent =
          data.message;
        document.getElementById("build-error-container").style.display =
          "block";
        // Hide the loading spinner
        document.getElementById("build-loading").style.display = "none";
      }
    } catch (error) {
      console.log("Error uploading file:", error);
      document.getElementById("build-loading").style.display = "none";
    }
  });

// Function to reset the UI (clear progress and error containers)
function resetUI() {
  // Clear the progress list
  const progressList = document.getElementById("build-progress-list");
  progressList.innerHTML = ""; // Remove all existing list items

  // Hide the result container (we don't want to show it initially)
  document.getElementById("build-result-container").style.display = "none";

  // Hide the error container and clear its message
  document.getElementById("build-error-container").style.display = "none";
  document.getElementById("build-error-message").textContent = "";

  // Hide the loading spinner at first (until upload starts)
  document.getElementById("build-loading").style.display = "none";

  // Show the progress container again when a new upload starts
  document.getElementById("build-progress-container").style.display = "block";
}

function validateBuildFile() {
  const fileInput = document.getElementById("build_file");
  const filePath = fileInput.value;

  // Only validate if the user has selected a file
  if (filePath) {
    const allowedExtensions = /(\.zip)$/i;

    if (!allowedExtensions.test(filePath)) {
      alert("Please upload a file with a .zip extension.");
      fileInput.value = ""; // Clear the input
    }
  }
}

function showPopup(backgroundColor) {
  const popup = document.getElementById("popup");

  // Display the popup and trigger the fade-in animation
  popup.style.display = "block";
  popup.style.animation = "fadeIn 1s forwards";

  popup.style.backgroundColor = backgroundColor;

  // Set a timeout to fade out the popup after 3 seconds
  setTimeout(function () {
    popup.style.animation = "fadeOut 1s forwards";
  }, 3000); // 3000 milliseconds = 3 seconds

  // Hide the popup completely after the fade-out animation finishes
  setTimeout(function () {
    popup.style.display = "none";
  }, 3000); // 3000 milliseconds
}

function dynamicalForm(config) {
  // Get the form container for the tab navigation and tab content
  const tabContainer = document.getElementById("subTabs3");
  const tabContentContainer = document.getElementById("tab-contents");

  // Clear previous tab contents (if any)
  tabContainer.innerHTML = "";
  tabContentContainer.innerHTML = "";

  // Create an object to keep track of which sections need a tab
  const sections = {
    cellular: [],
    TCP: [],
    others: [],
  };

  // Loop through the config object and categorize fields based on keywords
  for (const key in config) {
    if (config.hasOwnProperty(key)) {
      const fieldValue = config[key];

      // Check for "cellular" related fields and classify them
      if (key.includes("CELL") || key.includes("APN")) {
        sections.cellular.push({ key, fieldValue });
      }
      // Check for "tcp" related fields
      else if (key.includes("TCP")) {
        sections.TCP.push({ key, fieldValue });
      } else {
        sections.others.push({ key, fieldValue });
      }
    }
  }

  // Create the tab links dynamically
  let isFirstTab = true;
  for (const section in sections) {
    if (sections[section].length > 0) {
      console.log("iteration", section);
      console.log("isFirstTab", isFirstTab);
      // Create the tab item
      const tabItem = document.createElement("li");
      tabItem.classList.add("nav-item");
      tabItem.setAttribute("role", "presentation");

      const tabLink = document.createElement("a");
      tabLink.classList.add("nav-link");
      tabLink.setAttribute("id", `${section}-configuration-new`);
      tabLink.setAttribute("data-bs-toggle", "tab");
      tabLink.setAttribute("href", `#${section}-configuration-tab-new`);
      tabLink.setAttribute("role", "tab");
      tabLink.setAttribute("aria-controls", `${section}-configuration-tab-new`);
      tabLink.textContent = `${
        section.charAt(0).toUpperCase() + section.slice(1)
      } Configuration`;
      // Mark the first tab as active
      if (isFirstTab) {
        tabLink.classList.add("active"); // Apply active class to the first tab
        // isFirstTab = false;
      }

      tabItem.appendChild(tabLink);
      tabContainer.appendChild(tabItem);

      // Create the tab content
      const tabPane = document.createElement("div");
      tabPane.classList.add("tab-pane", "fade");
      tabPane.setAttribute("id", `${section}-configuration-tab-new`);
      tabPane.setAttribute("role", "tabpanel");
      tabPane.setAttribute("aria-labelledby", `${section}-configuration-new`);

      if (isFirstTab) {
        tabPane.classList.add("show"); // Show class for the first content
        tabPane.classList.add("active"); // Active class for the first tab content
        isFirstTab = false;
      }

      const tabRow = document.createElement("div");
      tabRow.classList.add("row", "card", "my-2", "mx-1");
      tabPane.appendChild(tabRow);

      const tabRowHeader = document.createElement("div");
      tabRowHeader.classList.add("card-header");
      tabRowHeader.textContent = `${
        section.charAt(0).toUpperCase() + section.slice(1)
      } Configuration`;
      tabRow.appendChild(tabRowHeader);

      const tabRowBody = document.createElement("div");
      tabRowBody.classList.add(
        "row",
        "card-body",
        "d-flex",
        "align-items-center"
      );
      tabRow.appendChild(tabRowBody);

      // Create the form fields for this section (e.g., TCP or Cellular)
      sections[section].forEach(({ key, fieldValue }) => {
        const fieldWrapper = document.createElement("div");
        if (fieldValue === "ON" || fieldValue === "OFF") {
          fieldWrapper.classList.add("col-md-4", "form-check", "form-switch");
          fieldWrapper.style.paddingLeft = "4em";
        } else {
          fieldWrapper.classList.add("col-md-4", "mb-3");
        }
        const label = document.createElement("label");
        label.classList.add("form-label");
        label.setAttribute("for", key);
        label.textContent = key
          .replace(/_/g, " ")
          .replace(/^./, (str) => str.toUpperCase()); // Make the label human-readable
        fieldWrapper.appendChild(label);

        // Generate the corresponding form input
        let input;
        if (fieldValue === "ON" || fieldValue === "OFF") {
          // Checkbox field (like the "Enable" toggle switch)
          input = document.createElement("input");
          input.classList.add("form-check-input", "mt-0");
          input.type = "checkbox";
          input.id = key;
          input.style.width = "32px";
          input.style.height = "16px";
          input.style.marginRight = "5px";
          input.checked = fieldValue === "ON";
          fieldWrapper.appendChild(input);
        } else if (
          fieldValue === "Choose mode" ||
          [
            "MASTER",
            "SLAVE",
            "P2P_MASTER",
            "P2P_SLAVE",
            "MESH_MASTER",
            "MESH_SLAVE",
          ].includes(fieldValue)
        ) {
          // Dropdown (select) field (like the "Modbus Mode")
          input = document.createElement("select");
          input.classList.add("form-select");
          input.id = key;
          const option1 = document.createElement("option");
          option1.value = "Choose mode";
          option1.textContent = "Choose mode";
          input.appendChild(option1);

          if (fieldValue === "Choose mode") {
            const option2 = document.createElement("option");
            option2.value = "TRUE";
            option2.textContent = "TRUE";
            input.appendChild(option2);
            const option3 = document.createElement("option");
            option3.value = "FALSE";
            option3.textContent = "FALSE";
            input.appendChild(option3);
          } else {
            const option = document.createElement("option");
            option.value = fieldValue;
            option.textContent = fieldValue;
            input.appendChild(option);
          }
          fieldWrapper.appendChild(input);
        } else {
          // Text input field (for text fields like IP Address, DNS, etc.)
          input = document.createElement("input");
          input.classList.add("form-control");
          input.type = "text";
          input.id = key;
          input.value = fieldValue;
          fieldWrapper.appendChild(input);
        }

        // Append the field wrapper to the tab row
        tabRowBody.appendChild(fieldWrapper);
      });

      // Append the tab content to the container
      tabContentContainer.appendChild(tabPane);
    }
  }
}

function handleFile(input) {
  const fileNameDisplay = document.getElementById("fileNameDisplay");
  if (input.files.length > 0) {
    fileNameDisplay.textContent = input.files[0].name;
    input.value = "";
  } else {
    fileNameDisplay.textContent = "No file selected";
  }
}

function getRandomColor() {
  const colors = [
    "#00994C",
    "#0000FF",
    "#FF9933",
    "#FF0000",
    "#FF33FF",
    "#009999",
    "#000099",
    "#66B2FF",
    "#CC0066",
    "#003319",
  ];
  const randomIndex = Math.floor(Math.random() * colors.length); // Generate a random index
  return colors[randomIndex]; // Return the color at the random index
}
