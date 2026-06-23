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
let holdingBuffer = "";
let refreshConfigForm = false;

let progressDFUItems = [];

let selectedDevice = null;
let dfuFile = null;

const commandHistory = []; // Array to store command history
let historyIndex = -1; // Current index for history navigation

let isFlashChecked = false; // variable that controls the state of flash (true or false)

let renamed_board_name = "";
let renamed_mac_address = "";
let renamed_mac_address_unitId = "";
let isDeviceConnected = false;
const appButtons = document.querySelectorAll("button");
const serialMonitorBtn = document.getElementById("serialMonitorBtn");
const appListItems = document.querySelectorAll("li");

// async function fetchStateAndApply(isAll) {
//   const res = await fetch("/get_state");
//   const data = await res.json();
//   const enabled = data.enabled === 1;
//   if (isAll === 1) {
//     const buttons = document.querySelectorAll("button");
//     const listItems = document.querySelectorAll("li");
//     buttons.forEach((button) => {
//       button.disabled = !enabled;
//     });
//     listItems.forEach((li) => {
//       li.style.pointerEvents = enabled ? "auto" : "none";
//       li.style.opacity = enabled ? "1" : "0.5";
//     });
//   } else {
//     document.getElementById("serialMonitorBtn").disabled = !enabled;
//     document.getElementById("firstLi").style.pointerEvents = enabled
//       ? "auto"
//       : "none";
//     document.getElementById("firstLi").style.opacity = enabled ? "1" : "0.5";
//   }
// }

// async function toggleState(newState, isAll) {
//   await fetch("/set_state", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ enabled: newState, isAll: isAll }),
//   });

//   fetchStateAndApply(isAll); // Reapply new state
// }

function validateLogin() {
  const u = document.getElementById("loginUsername").value;
  const p = document.getElementById("loginPass").value;
  if (u.toLowerCase() === "admin" && p === "7707") {
    document.getElementById("loginModal").style.display = "none";
    serialMonitorBtn.disabled = false;
    appListItems.forEach((li) => {
      li.style.pointerEvents = "auto";
      li.style.opacity = "1";
    });
  } else {
    alert("Invalid Username Or Password");
  }
}

/* verify if exist a username params in the url */
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

  serialMonitorBtn.disabled = true;
  appListItems.forEach((li) => {
    li.style.pointerEvents = "none";
    li.style.opacity = "0.5";
  });
  document.getElementById("loginModal").style.display = "flex";
  // fetchStateAndApply();
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

function flattenObject(obj, parentKey = "", result = {}) {
  for (let key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    const newKey = parentKey ? `${parentKey}.${key}` : key;
    if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      flattenObject(obj[key], newKey, result); // Recursively flatten
    } else {
      result[newKey] = obj[key];
    }
  }
  return result;
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
          const rawData = JSON.parse(fileEvent.target.result);
          const jsonData = flattenObject(rawData); // Flatten the JSON structure
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
              if (
                /\.EVENT$/.test(input.id) ||
                /\.ACTION$/.test(input.id) ||
                /\.FORMAT$/.test(input.id)
              ) {
                input.value = value;
              } else if (Array.isArray(value)) {
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
  const DMMregDictBlocks = {};
  const RMM4regDictBlocks = {};
  const MRH4regDictBlocks = {};
  const eventDictBlocks = {};
  // Step 1: Extract all input values
  inputs.forEach((input) => {
    const id = input.id;
    let value;
    if (input.type === "checkbox") {
      value = input.checked ? "ON" : "OFF";
    } else if (input.tagName === "SELECT") {
      if (
        /\.EVENT$/.test(input.id) ||
        /\.ACTION$/.test(input.id) ||
        /\.FORMAT$/.test(input.id)
      ) {
        value = input.value;
      } else {
        const options = Array.from(input.options);
        const selectedValue = input.value; // Get the selected value
        const optionValues = [
          selectedValue,
          ...options
            .filter((option) => option.value !== selectedValue)
            .map((option) => option.value),
        ];
        value = optionValues; // Store all options with the selected one first
      }
    } else {
      value = input.value;
    }
    inputDetails[id] = value;
  });
  // Step 2: Process DMM REGDICT
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_DMM_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockKey = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "FORMAT"

      if (!DMMregDictBlocks[blockKey]) {
        DMMregDictBlocks[blockKey] = {};
      }
      DMMregDictBlocks[blockKey][subKey] = inputDetails[key];

      delete inputDetails[key]; // Remove flattened key
    }
  }
  // Step 3: Collect EVENTDICT
  for (let key in inputDetails) {
    // Match pattern like PYTRO_DMM_EVENTDICT.130.EVENT
    const match = key.match(
      /^PYTRO_DMM_EVENTDICT\.(\d+)\.(\d+)\.(EVENT|PREV_VAL|CURRENT_VAL|UPDATE_REG|UPDATE_VAL|ACTION)$/
    );
    if (match) {
      const offset = match[1];
      const index = match[2];
      const field = match[3];
      if (!eventDictBlocks[offset]) {
        eventDictBlocks[offset] = {};
      }
      if (!eventDictBlocks[offset][index]) {
        eventDictBlocks[offset][index] = {};
      }

      eventDictBlocks[offset][index][field] = inputDetails[key];
      delete inputDetails[key];
    }
  }
  // Step 4: Process RMM4 REGDICT
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_RMM4_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockKey = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "FORMAT"

      if (!RMM4regDictBlocks[blockKey]) {
        RMM4regDictBlocks[blockKey] = {};
      }
      RMM4regDictBlocks[blockKey][subKey] = inputDetails[key];

      delete inputDetails[key]; // Remove flattened key
    }
  }
  // Step 5: Process MRH4 REGDICT
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_MRH4_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockKey = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "NODE_ID"

      if (!MRH4regDictBlocks[blockKey]) {
        MRH4regDictBlocks[blockKey] = {};
      }
      MRH4regDictBlocks[blockKey][subKey] = inputDetails[key];

      delete inputDetails[key]; // Remove flattened key
    }
  }
  // Step 6: Assemble the final structure
  const finalConfig = {
    ...inputDetails,
    PYTRO_DMM_EVENTDICT: eventDictBlocks,
    PYTRO_DMM_REGDICT: DMMregDictBlocks,
    PYTRO_RMM4_REGDICT: RMM4regDictBlocks,
    PYTRO_MRH4_REGDICT: MRH4regDictBlocks,
  };
  // Step 7: Export JSON
  // Convert the data object into a JSON string
  const jsonData = JSON.stringify(finalConfig, null, 2);
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

async function configFormForRefreshBtnOnly() {
  try {
    showLoading();
    document.getElementById("configFormDataContainer").style.display = "none";
    document.querySelectorAll(".loadMessageContainer").forEach((button) => {
      button.style.display = "flex";
    });
    document.querySelectorAll(".reconnect-btn").forEach((button) => {
      button.style.display = "none";
    });
    document.querySelectorAll(".loadMessageText").forEach((text) => {
      text.textContent = "";
    });
    setTimeout(() => {
      if (isDeviceConnected) {
        document.querySelectorAll(".loadMessageContainer").forEach((button) => {
          button.style.display = "none";
        });
        // hideLoading();
      } else {
        document.querySelectorAll(".loadMessageText").forEach((text) => {
          text.textContent =
            "Error to loading, please try to reconnect the device";
        });
        document.querySelectorAll(".reconnect-btn").forEach((button) => {
          button.style.display = "block";
        });
        hideLoading();
      }
    }, 1000);
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

async function configForm() {
  try {
    // showLoading();
    document.getElementById("configFormDataContainer").style.display = "none";
    document.querySelectorAll(".loadMessageContainer").forEach((button) => {
      button.style.display = "flex";
    });
    document.querySelectorAll(".reconnect-btn").forEach((button) => {
      button.style.display = "none";
    });
    document.querySelectorAll(".loadMessageText").forEach((text) => {
      text.textContent = "";
    });
    setTimeout(() => {
      if (isDeviceConnected) {
        document.querySelectorAll(".loadMessageContainer").forEach((button) => {
          button.style.display = "none";
        });
        // hideLoading();
      } else {
        document.querySelectorAll(".loadMessageText").forEach((text) => {
          text.textContent =
            "Error to loading, please try to reconnect the device";
        });
        document.querySelectorAll(".reconnect-btn").forEach((button) => {
          button.style.display = "block";
        });
        hideLoading();
      }
    }, 1000);
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
  event.preventDefault();
  const form = document.getElementById("dynamicConfigForm");
  const inputs = form.querySelectorAll("input, select");
  const inputDetails = {};
  inputs.forEach((input) => {
    const id = input.id;
    let value;
    if (input.type === "checkbox") {
      value = input.checked ? "ON" : "OFF";
    } else if (
      input.tagName === "SELECT" &&
      !/\.EVENT$/.test(input.id) &&
      !/\.ACTION$/.test(input.id) &&
      !/\.FORMAT$/.test(input.id)
    ) {
      // For select elements, get all options
      const options = Array.from(input.options);
      const selectedValue = input.value; // Get the selected value
      const optionValues = [
        selectedValue,
        ...options
          .filter((option) => option.value !== selectedValue)
          .map((option) => option.value),
      ];
      value = optionValues; // Store all options with the selected one first
    } else {
      value = input.value;
    }
    inputDetails[id] = value;
  });
  const DMMregDictBlocks = {};
  const RMM4regDictBlocks = {};
  const MRH4regDictBlocks = {};
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_DMM_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockNumber = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "FORMAT"

      if (!DMMregDictBlocks[blockNumber]) {
        DMMregDictBlocks[blockNumber] = {}; // Initialize the block if it doesn't exist
      }

      DMMregDictBlocks[blockNumber][subKey] = inputDetails[key]; // Add the subkey and value to the block

      // Remove the flattened key from inputDetails
      delete inputDetails[key];
    }
  }
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_RMM4_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockNumber = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "FORMAT"

      if (!RMM4regDictBlocks[blockNumber]) {
        RMM4regDictBlocks[blockNumber] = {}; // Initialize the block if it doesn't exist
      }

      RMM4regDictBlocks[blockNumber][subKey] = inputDetails[key]; // Add the subkey and value to the block

      // Remove the flattened key from inputDetails
      delete inputDetails[key];
    }
  }
  for (let key in inputDetails) {
    const match = key.match(/^PYTRO_MRH4_REGDICT\.(\d+)\.(\w+)$/);
    if (match) {
      const blockNumber = match[1]; // e.g., "1"
      const subKey = match[2]; // e.g., "NODE_ID"

      if (!MRH4regDictBlocks[blockNumber]) {
        MRH4regDictBlocks[blockNumber] = {}; // Initialize the block if it doesn't exist
      }

      MRH4regDictBlocks[blockNumber][subKey] = inputDetails[key]; // Add the subkey and value to the block

      // Remove the flattened key from inputDetails
      delete inputDetails[key];
    }
  }

  // Step 3: Extract EVENTDICT blocks with editable offsets
  const rawEventDict = {};

  for (let key in inputDetails) {
    const match = key.match(
      /^PYTRO_DMM_EVENTDICT\.(\d+)\.(\d+)\.(EVENT|PREV_VAL|CURRENT_VAL|UPDATE_REG|UPDATE_VAL|ACTION|OFFSET)$/
    );
    if (match) {
      const originalOffset = match[1];
      const conditionIndex = match[2];
      const field = match[3];

      if (!rawEventDict[originalOffset]) {
        rawEventDict[originalOffset] = {};
      }
      if (!rawEventDict[originalOffset][conditionIndex]) {
        rawEventDict[originalOffset][conditionIndex] = {};
      }

      rawEventDict[originalOffset][conditionIndex][field] = inputDetails[key];
      delete inputDetails[key];
    }
  }

  // Step 4: Flatten and reassign to new offsets
  const mergedEventDictBlocks = {};

  for (const offset in rawEventDict) {
    for (const conditionIndex in rawEventDict[offset]) {
      const condition = rawEventDict[offset][conditionIndex];
      const newOffset = condition["OFFSET"] || offset;

      delete condition["OFFSET"]; // Clean out OFFSET field

      if (!mergedEventDictBlocks[newOffset]) {
        mergedEventDictBlocks[newOffset] = [];
      }

      mergedEventDictBlocks[newOffset].push(condition);
    }
  }

  // Step 5: Reindex conditions per offset
  const eventDictBlocks = {};
  for (const offset in mergedEventDictBlocks) {
    const conditions = mergedEventDictBlocks[offset];
    eventDictBlocks[offset] = {};

    conditions.forEach((condition, index) => {
      eventDictBlocks[offset][String(index + 1)] = condition;
    });
  }

  // Step 6: Merge into final config object
  if (Object.keys(DMMregDictBlocks).length > 0) {
    inputDetails["PYTRO_DMM_REGDICT"] = DMMregDictBlocks; // Keep as an object, not a string
  }
  if (Object.keys(RMM4regDictBlocks).length > 0) {
    inputDetails["PYTRO_RMM4_REGDICT"] = RMM4regDictBlocks; // Keep as an object, not a string
  }
  if (Object.keys(MRH4regDictBlocks).length > 0) {
    inputDetails["PYTRO_MRH4_REGDICT"] = MRH4regDictBlocks; // Keep as an object, not a string
  }

  if (Object.keys(eventDictBlocks).length > 0) {
    inputDetails["PYTRO_DMM_EVENTDICT"] = eventDictBlocks;
  }

  // Log the final inputDetails to verify
  console.log("Final inputDetails:", inputDetails);
  saveToConfigFile(inputDetails, "Form Saved Successfully", "#208f5b");
}

function generateForm(config) {
  document.getElementById("configFormDataContainer").style.display = "block";
  document.querySelectorAll(".loadMessageContainer").forEach((button) => {
    button.style.display = "none";
  });
  const form = document.getElementById("dynamicConfigForm");
  form.innerHTML = "";

  // This object will hold groups of keys by their prefix
  const groupedConfig = {};

  // Step 1: Group keys by their prefix
  for (const [key, value] of Object.entries(config)) {
    const parts = key.split("_");
    if (parts.includes("MCU")) {
      // Take first 3 parts for MCU (e.g., PYTRO_MCU_LOG)
      prefix = parts.slice(0, 3).join("_");
    } else {
      // Take first 2 parts for others (e.g., PYTRO_CELL)
      prefix = parts.slice(0, 2).join("_");
    }
    if (!groupedConfig[prefix]) {
      groupedConfig[prefix] = [];
    }
    groupedConfig[prefix].push([key, value]);
  }

  // Step 2: Iterate over each group and create a container
  for (const [prefix, items] of Object.entries(groupedConfig)) {
    // Create a container for this group
    const groupContainer = document.createElement("div");
    groupContainer.classList.add("card", "mb-4");

    // Group header (e.g., "PYTRO_CELL" as the title)
    const groupHeader = document.createElement("div");
    groupHeader.classList.add("card-header", "fw-bold", "bg-light");
    groupHeader.textContent = prefix.replaceAll("_", " ");
    groupContainer.appendChild(groupHeader);

    const groupBody = document.createElement("div");
    groupBody.classList.add("card-body");

    // Step 3: Add all key-value pairs in this group to the container
    items.forEach(([key, value]) => {
      if (key !== `${prefix}_HARDWARE`) {
        // create the row tag
        const row = document.createElement("div");
        row.classList.add("row", "align-items-center", "mb-4");

        // create col div for each label & input
        const labelCol = document.createElement("div");
        labelCol.classList.add("col-12", "col-sm-6", "col-md-4", "flex-25");
        const inputCol = document.createElement("div");
        key === "PYTRO_DMM_EVENTDICT"
          ? inputCol.classList.add("col-12", "col-md-12", "col-lg-8")
          : key === "PYTRO_DMM_REGDICT"
          ? inputCol.classList.add("col-12", "col-md-12", "col-lg-5")
          : inputCol.classList.add("col-12", "col-md-12", "col-lg-4");

        const label = document.createElement("label");
        const labelName = key.replaceAll("_", " ");
        label.setAttribute("for", key);
        label.textContent = labelName;
        if (value === "ON" || value === "OFF") {
          inputCol.classList.add("form-switch");
        }
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
        } else if (typeof value === "object" && value !== null) {
          // Handle dictionary object
          const fieldset = document.createElement("fieldset");
          fieldset.classList.add("form-control", "p-2");

          if (key === "PYTRO_DMM_REGDICT") {
            for (const [subKey, subValue] of Object.entries(value)) {
              const subFieldset = document.createElement("fieldset");
              subFieldset.classList.add("form-group", "p-2");
              const subLabelContainer = document.createElement("div");
              const subInputsContainer = document.createElement("div");
              subInputsContainer.classList.add(
                "d-flex",
                "justify-content-between"
              );
              const subLabel = document.createElement("label");
              subLabel.setAttribute("for", `${key}.${subKey}`);
              subLabel.textContent = `Block ${subKey}`;
              subLabel.classList.add("form-label", "mt-2", "fw-bold");
              subLabelContainer.appendChild(subLabel);
              subFieldset.appendChild(subLabelContainer);

              for (const [fieldKey, fieldValue] of Object.entries(subValue)) {
                const fieldRow = document.createElement("div");
                fieldRow.classList.add("flex-32");
                const fieldLabelCol = document.createElement("div");
                const fieldInputCol = document.createElement("div");
                const fieldLabel = document.createElement("label");
                fieldLabel.textContent = fieldKey;
                fieldLabel.setAttribute("for", `${key}.${subKey}.${fieldKey}`);
                fieldLabelCol.appendChild(fieldLabel);

                let input;
                if (fieldKey === "FORMAT") {
                  input = document.createElement("select");
                  input.setAttribute("id", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("name", `${key}.${subKey}.${fieldKey}`);
                  input.classList.add("form-select");
                  const options = ["UInt16", "UInt32", "Float"];
                  options.forEach((opt) => {
                    const option = document.createElement("option");
                    option.value = opt;
                    option.textContent = opt;
                    if (opt === fieldValue) {
                      option.selected = true;
                    }
                    input.appendChild(option);
                  });
                } else {
                  input = document.createElement("input");
                  input.setAttribute("type", "text");
                  input.setAttribute("id", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("name", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("value", fieldValue);
                  input.classList.add("form-control");
                }
                fieldInputCol.appendChild(input);
                fieldRow.appendChild(fieldLabelCol);
                fieldRow.appendChild(fieldInputCol);
                subInputsContainer.appendChild(fieldRow);
              }
              subFieldset.appendChild(subInputsContainer);
              fieldset.appendChild(subFieldset);
            }
          } else if (key === "PYTRO_RMM4_REGDICT") {
            for (const [subKey, subValue] of Object.entries(value)) {
              const subFieldset = document.createElement("fieldset");
              subFieldset.classList.add("form-group", "p-2");
              const subLabelContainer = document.createElement("div");
              const subInputsContainer = document.createElement("div");
              subInputsContainer.classList.add(
                "d-flex",
                "justify-content-between"
              );
              const subLabel = document.createElement("label");
              subLabel.setAttribute("for", `${key}.${subKey}`);
              subLabel.textContent = `Block ${subKey}`;
              subLabel.classList.add("form-label", "mt-2", "fw-bold");
              subLabelContainer.appendChild(subLabel);
              subFieldset.appendChild(subLabelContainer);

              for (const [fieldKey, fieldValue] of Object.entries(subValue)) {
                const fieldRow = document.createElement("div");
                fieldRow.classList.add("flex-32");
                const fieldLabelCol = document.createElement("div");
                const fieldInputCol = document.createElement("div");
                const fieldLabel = document.createElement("label");
                fieldLabel.textContent = fieldKey;
                fieldLabel.setAttribute("for", `${key}.${subKey}.${fieldKey}`);
                fieldLabelCol.appendChild(fieldLabel);

                let input;
                if (fieldKey === "FORMAT") {
                  input = document.createElement("select");
                  input.setAttribute("id", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("name", `${key}.${subKey}.${fieldKey}`);
                  input.classList.add("form-select");
                  const options = ["UInt16", "UInt32", "Float"];
                  options.forEach((opt) => {
                    const option = document.createElement("option");
                    option.value = opt;
                    option.textContent = opt;
                    if (opt === fieldValue) {
                      option.selected = true;
                    }
                    input.appendChild(option);
                  });
                } else {
                  input = document.createElement("input");
                  input.setAttribute("type", "text");
                  input.setAttribute("id", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("name", `${key}.${subKey}.${fieldKey}`);
                  input.setAttribute("value", fieldValue);
                  input.classList.add("form-control");
                }
                fieldInputCol.appendChild(input);
                fieldRow.appendChild(fieldLabelCol);
                fieldRow.appendChild(fieldInputCol);
                subInputsContainer.appendChild(fieldRow);
              }
              subFieldset.appendChild(subInputsContainer);
              fieldset.appendChild(subFieldset);
            }
          } else if (key === "PYTRO_MRH4_REGDICT") {
            for (const [subKey, subValue] of Object.entries(value)) {
              const subFieldset = document.createElement("fieldset");
              subFieldset.classList.add("form-group", "p-2");
              const subLabelContainer = document.createElement("div");
              const subInputsContainer = document.createElement("div");
              subInputsContainer.classList.add(
                "d-flex",
                "justify-content-between"
              );
              const subLabel = document.createElement("label");
              subLabel.setAttribute("for", `${key}.${subKey}`);
              subLabel.textContent = `Block ${subKey}`;
              subLabel.classList.add("form-label", "mt-2", "fw-bold");
              subLabelContainer.appendChild(subLabel);
              subFieldset.appendChild(subLabelContainer);

              for (const [fieldKey, fieldValue] of Object.entries(subValue)) {
                const fieldRow = document.createElement("div");
                fieldRow.classList.add("flex-47");
                const fieldLabelCol = document.createElement("div");
                const fieldInputCol = document.createElement("div");
                const fieldLabel = document.createElement("label");
                fieldLabel.textContent = fieldKey;
                fieldLabel.setAttribute("for", `${key}.${subKey}.${fieldKey}`);
                fieldLabelCol.appendChild(fieldLabel);

                let input;
                input = document.createElement("input");
                input.setAttribute("type", "text");
                input.setAttribute("id", `${key}.${subKey}.${fieldKey}`);
                input.setAttribute("name", `${key}.${subKey}.${fieldKey}`);
                input.setAttribute("value", fieldValue);
                input.classList.add("form-control");

                fieldInputCol.appendChild(input);
                fieldRow.appendChild(fieldLabelCol);
                fieldRow.appendChild(fieldInputCol);
                subInputsContainer.appendChild(fieldRow);
              }
              subFieldset.appendChild(subInputsContainer);
              fieldset.appendChild(subFieldset);
            }
          } else {
            for (const [offsetKey, conditionDict] of Object.entries(value)) {
              for (const [conditionIndex, eventFields] of Object.entries(
                conditionDict
              )) {
                if (isNaN(conditionIndex)) continue; // skip non-numeric (invalid) keys

                const conditionRow = document.createElement("div");
                conditionRow.classList.add(
                  "form-group",
                  "p-2",
                  "d-flex",
                  "justify-content-between",
                  "align-items-start"
                );

                // OFFSET input (this row's offset value)
                const offsetInputWrapper = document.createElement("div");
                offsetInputWrapper.classList.add("flex-14");

                const offsetLabel = document.createElement("label");
                offsetLabel.textContent = "OFFSET";
                offsetLabel.setAttribute("for", `${key}.${offsetKey}`);
                const offsetInput = document.createElement("input");
                offsetInput.setAttribute("type", "text");
                offsetInput.setAttribute(
                  "id",
                  `PYTRO_DMM_EVENTDICT.${offsetKey}.${conditionIndex}.OFFSET`
                );
                offsetInput.setAttribute(
                  "name",
                  `PYTRO_DMM_EVENTDICT.${offsetKey}.${conditionIndex}.OFFSET`
                );
                offsetInput.classList.add("form-control", "event-index-input");
                offsetInput.setAttribute("value", offsetKey);

                offsetInputWrapper.appendChild(offsetLabel);
                offsetInputWrapper.appendChild(offsetInput);
                conditionRow.appendChild(offsetInputWrapper);

                // Event fields in order
                const fieldOrder = [
                  "EVENT",
                  "PREV_VAL",
                  "CURRENT_VAL",
                  "UPDATE_REG",
                  "UPDATE_VAL",
                  "ACTION",
                ];
                fieldOrder.forEach((fieldKey) => {
                  const fieldValue = eventFields[fieldKey] ?? "";

                  const fieldWrapper = document.createElement("div");
                  fieldWrapper.classList.add("flex-14");

                  const label = document.createElement("label");
                  label.textContent = fieldKey;
                  label.setAttribute(
                    "for",
                    `${key}.${offsetKey}.${conditionIndex}.${fieldKey}`
                  );

                  let input;
                  if (fieldKey === "EVENT" || fieldKey === "ACTION") {
                    input = document.createElement("select");
                    input.classList.add("form-select");

                    const options =
                      fieldKey === "EVENT"
                        ? [
                            "RISING_EDGE",
                            "FALLING_EDGE",
                            "EQUAL",
                            "ONCHANGE",
                            "HIGHER",
                            "HIGHEREQ",
                            "LOWER",
                            "LOWEREQ",
                          ]
                        : ["PUSH", "UPDATE_PUSH", "TEST"];

                    options.forEach((opt) => {
                      const option = document.createElement("option");
                      option.value = opt;
                      option.textContent = opt;
                      if (opt === fieldValue) {
                        option.selected = true;
                      }
                      input.appendChild(option);
                    });
                  } else {
                    input = document.createElement("input");
                    input.setAttribute("type", "text");
                    input.classList.add("form-control");
                    input.setAttribute("value", fieldValue);
                  }

                  input.setAttribute(
                    "name",
                    `${key}.${offsetKey}.${conditionIndex}.${fieldKey}`
                  );
                  input.setAttribute(
                    "id",
                    `${key}.${offsetKey}.${conditionIndex}.${fieldKey}`
                  );
                  input.classList.add("event-field");

                  fieldWrapper.appendChild(label);
                  fieldWrapper.appendChild(input);
                  conditionRow.appendChild(fieldWrapper);
                });

                // Append full condition row
                fieldset.appendChild(conditionRow);
              }
            }
          }

          inputCol.appendChild(fieldset);
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
        groupBody.appendChild(row);
      }
    });
    groupContainer.appendChild(groupBody);
    form.appendChild(groupContainer);
  }
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
    document.getElementById("popup").textContent = "Parameter added successfully";
    showPopup("#439a43");
    hideNewFieldModal();
    // update apps.json and apps_id.json with the new field
    const fieldLabel = result.label; // PYTRO_RFC_DS_TES
    const appKey = fieldLabel.split("_").slice(0, 2).join("_");
    console.log("appKey", appKey, "unitid", renamed_mac_address_unitId)
    fetch("/promote-app-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: appKey,
        unitId: renamed_mac_address_unitId,
        field: {
          name: fieldLabel,
          value: result.value,
          type: result.type
        }
      })
    })
    .then(res => res.json())
    .then(resp => {
      console.log("Field promoted:", resp);
    });
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

function showLoading() {
  console.log("Show loading modal...");
  const modal = document.getElementById("loadingModal");
  modal.style.display = "block";
  setTimeout(() => {
    // Use computed style to check actual display value
    const computedStyle = window.getComputedStyle(modal);
    if (computedStyle.display === "block") {
      modal.style.display = "none";
      console.log("blocked");
    } else {
      console.log("loading modal was already hidden");
    }
  }, 10000);
}

function hideLoading() {
  console.log("Hide loading modal...");
  document.getElementById("loadingModal").style.display = "none";
}

// Global cache for previous values
let previousHolding = {};

function extractHoldingBlocks() {
  const regex = /=holding=\s*\n(\{[\s\S]*?\})\s*\n=holding=/g;
  let match;

  while ((match = regex.exec(holdingBuffer)) !== null) {
    const dictText = match[1];
    // console.log("dictText", dictText)
    // Process block
    handleHoldingBlock(`holding = ${dictText}`);

    // Remove processed text safely
    holdingBuffer = holdingBuffer.slice(match.index + match[0].length);

    // Reset regex index because buffer changed
    regex.lastIndex = 0;
    
  }
}

function handleHoldingBlock(block) {
  const lineMatch = block.match(/holding\s*=\s*(\{[\s\S]*\})/);
  if (!lineMatch) return;

  const holdingDict = parsePythonDict(lineMatch[1]);
  if (!holdingDict) return;
  // console.log(holdingDict)
  updateHoldingTable(holdingDict);
}

function parsePythonDict(dictText) {
  const jsonText = dictText
    .replace(/(\d+)\s*:/g, '"$1":')
    .replace(/'/g, '"');

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("Failed to parse holding dict", err);
    return null;
  }
}

function getUniqueKeyDiv10Plus(holding) {
  const keys = Object.keys(holding)
    .map(Number)
    .sort((a, b) => a - b);

  const result = [];
  const seen = new Set();

  for (const key of keys) {
    const div10 = Math.floor(key / 10);

    if (!seen.has(div10)) {
      seen.add(div10);
      result.push(div10 * 10 + 40001);
    }
  }

  return result;
}

function updateHoldingTable(holding) {
  const table = document.getElementById("holding-table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const emptyRow = document.getElementById("holding-empty");
  const rowAddresses = getUniqueKeyDiv10Plus(holding);
  const seenRows = new Set();
   // ✅ hide static empty row when data arrives
  if (emptyRow) emptyRow.style.display = "none";

  rowAddresses.forEach(rowAddr => {
    seenRows.add(String(rowAddr));

    let tr = tbody.querySelector(`tr[data-row="${rowAddr}"]`);

    if (!tr) {
      tr = document.createElement("tr");
      tr.dataset.row = rowAddr;

      // address cell
      const addrTd = document.createElement("td");
      addrTd.className = "addr";
      tr.appendChild(addrTd);

      // data cells
      for (let i = 0; i < 10; i++) {
        tr.appendChild(document.createElement("td"));
      }

      tbody.appendChild(tr);
    }

    const tds = tr.querySelectorAll("td");
    tds[0].textContent = rowAddr;

    const baseKey = rowAddr - 40001;

    for (let i = 0; i < 10; i++) {
      const td = tds[i + 1];
      const key = baseKey + i;

      const newValue = holding[key];
      const oldValue = previousHolding[key];

      td.textContent = newValue !== undefined
        ? Number(newValue).toFixed(2)
        : "-";

      td.classList.remove("cell-new", "cell-changed");

      // 🟩 NEW CELL
      if (oldValue === undefined && newValue !== undefined) {
        td.classList.add("cell-new");
        setTimeout(() => td.classList.remove("cell-new"), 1000);
      }

      // 🟨 CHANGED CELL
      else if (oldValue !== undefined && Number(newValue) !== Number(oldValue)) {
        td.classList.add("cell-changed");
        setTimeout(() => td.classList.remove("cell-changed"), 800);
      }
    }
  });

  // Remove rows that no longer exist
  [...tbody.querySelectorAll("tr")].forEach(tr => {
    if (!seenRows.has(tr.dataset.row)) {
      tr.remove();
    }
  });

  previousHolding = { ...holding };
}

async function SerialMonitor() {
  if (isDeviceConnected == true) {
    document.getElementById("popup").textContent = "Device Already Connected";
    showPopup("#e34c5a");
  } else {
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
      await SerialWrite(
        `\x03\r\nimport ubinascii,machine,network\r\na = ubinascii.hexlify(network.LAN().config('mac'), ':').decode().upper() if hasattr(network, "LAN") else machine.unique_id()[4:].hex().upper()\r\nprint(f"<>mac address : {a}<>")\r\nprint(f"<>board name : {machine.board_name()}<>")\r\n`
      );
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
            // console.log(
            //   `Size of terminal: ${
            //     new TextEncoder().encode(textArea.textContent).length
            //   } bytes`
            // );
            // Check if the text content size exceeds 100KB (102,400 bytes)
            if (
              new TextEncoder().encode(textArea.textContent).length > 102400
            ) {
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
            const lines = textArea.textContent.split("\n");
            for (const line of lines) {
              if (!line.includes("print(")) {
                const macMatch = line.match(
                  /<>mac address\s*:\s*([^<>]+)\s*<>/
                );
                if (macMatch) {
                  const mac_address = macMatch[1].trim();
                  renamed_mac_address = mac_address;
                  renamed_mac_address_unitId = mac_address
                    .replace(/:/g, "")
                    .toUpperCase();
                }

                const boardMatch = line.match(
                  /<>board name\s*:\s*([^<>]+)\s*<>/
                );
                if (boardMatch) {
                  const board_name = boardMatch[1].trim();
                  renamed_board_name = board_name;
                  setBoardName(renamed_board_name);
                }
              }
            }
            //check board name
            // const namematch = textArea.textContent.match(
            //   /<>board name\s*:\s*([^<>]+)\s*<>/
            // );
            // const macAddressMatch = textArea.textContent.match(
            //   /<>mac address\s*:\s*([0-9A-Fa-f:]{17})<>/
            // );
            // if (macAddressMatch) {
            //   const mac_address = macAddressMatch[1];
            //   renamed_mac_address = mac_address.replace(/:/g, "").toUpperCase();
            //   console.log(renamed_mac_address);
            // }
            // if (namematch) {
            //   // Extract the matched portion and clean it up
            //   const board_name = namematch[1].trim();
            //   renamed_board_name = board_name;
            //   setBoardName(renamed_board_name);
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
            // }
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
                document.getElementById(
                  "fileSystemContainerTable"
                ).style.height = "100%";
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
            holdingBuffer += Serialdata;
            extractHoldingBlocks();
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
                  /(PYTRO_\w+)\s*=\s*(\d+|'[^']+'|\[\s*'[^']+'\s*(?:,\s*'[^']+'\s*)*\]|\{[\s\S]*?\})/g;
                const keyValueMatches = [
                  ...contentBetweenQuotes.matchAll(pattern),
                ];
                // If the content contains key-value pairs, process it
                if (keyValueMatches.length > 4) {
                  // console.log("CONTENT BETWEEN QUOTES:", contentBetweenQuotes);
                  // Loop through matches and extract the key-value pairs
                  console.log(keyValueMatches)
                  keyValueMatches.forEach((matchData) => {
                    const key = matchData[1].trim(); // Extract key (e.g., 'key1')
                    const value = matchData[2].trim(); // Extract value (e.g., 'value1')
                    if (key && value) {
                      // Clean up the key and value, and store them
                      const TreatedVal = value.replace(/^'(.*)'$/, "$1");
                      try {
                        if (
                          TreatedVal.startsWith("{") ||
                          TreatedVal.startsWith("[")
                        ) {
                          // Replace all single quotes with double quotes ONLY if it's not already valid JSON
                          const safeJson = TreatedVal.replace(/'/g, '"');
                          configParameters[key] = JSON.parse(safeJson);
                        } else {
                          configParameters[key] = TreatedVal;
                        }
                      } catch (e) {
                        console.error(
                          `Error parsing key "${key}" with value:`,
                          value,
                          e
                        );
                        configParameters[key] = TreatedVal;
                      }
                    }
                  });
                  console.log("DATA AFTER CLEANING:", configParameters);
                  // showLoading();
                  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
                    .then((res) => res.json())
                    .then((data) => {
                      // Apply configParameters to appData
                      data.apps.forEach((appObj) => {
                        const appKey = Object.keys(appObj)[0];
                        const appData = appObj[appKey];

                        for (const configKey in configParameters) {
                          if (
                            configParameters.hasOwnProperty(configKey) &&
                            configKey.startsWith(appKey + "_")
                          ) {
                            appData[configKey] = configParameters[configKey];
                          }
                        }
                      });

                      // Send updated data to server
                      return fetch("/update-apps", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          mac: renamed_mac_address,
                          apps: data.apps,
                          unitId: renamed_mac_address_unitId,
                          board: renamed_board_name,
                          MMR_METADATA: data.MMR_METADATA || {}
                        }),
                      });
                    })
                    .then((res) => res.json())
                    .then((result) => {
                      if (result.status === "success") {
                        console.log(
                          "Updated successfully, now fetching again..."
                        );
                        return fetch(
                          `/get-data?macId=${renamed_mac_address_unitId}`
                        ); // Only fetch again after successful update
                      } else {
                        throw new Error("Update failed: " + result.message);
                      }
                    })
                    .then((res) => res.json())
                    .then((data) => {
                      // ✅ Now handle rendering after fresh fetch
                      const storeContainer = document.getElementById(
                        "apps-store-container"
                      );
                      const installedContainer = document.getElementById(
                        "apps-installed-container"
                      );

                      const boardInfo = `
                      <h6>Board Name : <strong>${renamed_board_name}</strong></h6>
                      <h6>Board ID : <strong>${data.unitId}</strong></h6>
                    `;
                      storeContainer.innerHTML = boardInfo;
                      installedContainer.innerHTML = boardInfo;

                      let rowsHTML = "";
                      data.apps.forEach((appObj) => {
                        const appKey = Object.keys(appObj)[0];
                        const appData = appObj[appKey];
                        const name =
                          appData.NAME || appKey.replaceAll("_", " ");
                        const description =
                          appData.DESCRIPTION || "Description Not Available";
                        const publisher =
                          appData.PUBLISHER || "Publisher Not Available";
                        const category =
                          appData.CATEGORY || "Category Not Available";
                        const size = appData.SIZE
                          ? `${appData.SIZE} MB`
                          : "Size Not Available";
                        const enableField = appKey + "_ENABLE";

                        const appHTML = `
                        <div class="d-flex flex-column flex-md-row justify-content-md-between store-apps-border gap-3 gap-md-0">
                          <div class="d-flex gap-4 flex-85">
                            <div>
                              <i class="fa fa-terminal terminal-icon" aria-hidden="true"
                                style="background-color: #efefef; font-weight: bold; padding-inline: 12px; padding-block: 9px; font-size: 20px; border-radius: 4px;">
                              </i>
                            </div>
                            <div>
                              <h5>${name}</h5>
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
                        const icons =
                          document.querySelectorAll(".terminal-icon");
                        icons.forEach(function (icon) {
                          icon.style.color = getRandomColor();
                        });

                        // Installed apps table
                        if (
                          appData[enableField] &&
                          appData[enableField].toUpperCase() === "ON"
                        ) {
                          rowsHTML += `
                          <tr>
                            <td class="fw-medium">${name}</td>
                            <td>${size}</td>
                            <td style="width:30%">${description}</td>
                            <td><span class="status-running">Running</span></td>
                            <td>
                              <div class="d-flex flex-column justify-content-center flex-md-row gap-2">
                                <button class="btn btn-primary" onclick="editApp('${appKey}')"><i class="fa fa-pencil-square-o"></i> Edit</button>
                                <button class="btn btn-danger" onclick="stopApp('${appKey}')"><i class="fa fa-stop"></i> Stop</button>
                                <button class="btn btn-secondary" onclick="stopApp('${appKey}')"><i class="fa fa-trash"></i> Uninstall</button>
                              </div>
                            </td>
                          </tr>
                        `;
                        }
                      });

                      if (!rowsHTML) {
                        rowsHTML = `<tr><td colspan="5" class="text-center">No apps enabled.</td></tr>`;
                      }

                      installedContainer.innerHTML += `
                      <div class="table-responsive">
                        <table class="table table-hover apps-table">
                          <thead class="table-light">
                            <tr>
                              <th>Name</th><th>Size</th><th>Description</th><th>Status</th><th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>${rowsHTML}</tbody>
                        </table>
                      </div>
                    `;

                      // Final cleanup
                      dataBuffer = "";
                      configuration = false;
                      configParameters = {};
                      console.log("Done CLEANING:", configParameters);
                    })
                    .catch((err) => {
                      console.error("Something failed:", err);
                      document.getElementById(
                        "apps-installed-container"
                      ).innerHTML =
                        "<span class='d-flex justify-content-center'>Failed to load data.</span>";
                      document.getElementById(
                        "apps-store-container"
                      ).innerHTML =
                        "<span class='d-flex justify-content-center'>Failed to load data.</span>";
                    })
                    .finally(() => {
                      hideLoading();
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
        document.getElementById("configFormDataContainer").style.display =
          "none";
        document.querySelectorAll(".configForm-buttons").forEach((button) => {
          button.style.display = "none";
        });
        setBoardName("(Not connected)");
        holdingBuffer = "";
        previousHolding = {};
        hideLoading();
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
      holdingBuffer = "";
      previousHolding = {};
      hideLoading();
    }
  }
}

async function saveToConfigFile(mergedConfig, popupTitle, popupBackground) {
  // Step 1: Get keys ending in _ENABLE and derive app names
  const enableKeys = Object.keys(mergedConfig).filter((key) =>
    key.includes("_ENABLE")
  );
  const cleanedKeys = enableKeys.map((key) => key.replace("_ENABLE", ""));
  // Step 2: Create an empty object to store the structured apps
  let structuredConfig = {};
  // Step 3: Group each app into its own object based on cleaned keys
  for (let cleanedKey of cleanedKeys) {
    structuredConfig[cleanedKey] = {};

    // For each app, add all its settings
    for (let [key, value] of Object.entries(mergedConfig)) {
      if (key.startsWith(cleanedKey)) {
        // const newKey = key.replace(cleanedKey + "_", ""); // Remove the component prefix
        structuredConfig[cleanedKey][key] = value;
      }
    }
  }
  console.log("the structuredConfig:", structuredConfig);
  // Create a formatted string to save
  let formattedApps = "";
  for (let [appKey, appValue] of Object.entries(structuredConfig)) {
    for (let [key, value] of Object.entries(appValue)) {
      if (structuredConfig[appKey][`${appKey}_ENABLE`] === "ON") {
        //   console.log(`the enabled apps ${appKey}_ENABLE`);

        if (key.includes("DICT") || key.includes("CAGES")) {
          // Convert PYTRO_DMM_REGDICT to JSON with double quotes inside, single quotes outside
          const jsonStr = JSON.stringify(value); // JSON.stringify will handle double quotes inside
          formattedApps += `${key} = '${jsonStr.replace(/'/g, "\\'")}'\\r\\n`;
        } else if (typeof value === "object") {
          // Handle other objects (like arrays from selects) using single quotes inside
          const objectString = JSON.stringify(value).replace(/"/g, "'");
          formattedApps += `${key} = ${objectString}\\r\\n`;
        } else if (value.trim() === "") {
          formattedApps += `${key} = ''\\r\\n`;
        } else {
          formattedApps += `${key} = '${value}'\\r\\n`;
        }
      } else {
        // In the else condition, add the _ENABLE keys that are "OFF"
        if (key === `${appKey}_ENABLE`) {
          formattedApps += `${key} = '${value}'\\r\\n`;
        }
      }
    }
  }
  console.log("formattedApps:", formattedApps);
  // Split into lines, *keeping* the \r\n at the end of each line
  const lines = formattedApps.split(/(?<=\\r\\n)/);
  // console.log(lines); // each element ends with "\r\n"
  await StopScript();
  await sleep(100);
  try {
    // await SerialWrite(
    //   `import os\r\nos.remove('config.py')\r\nf=open('config.py','w')\r\nf.write('''${formattedApps}''')\r\nf.close()\r\n`
    // );
    showLoading();
    await SerialWrite(
      `import os\r\nos.remove('config.py')\r\nf=open('config.py','w')\r\n`
    );
    // // send in slices
    // const chunkSize = 500;
    // for (let i = 0; i < formattedApps.length; i += chunkSize) {
    //   const chunk = formattedApps.slice(i, i + chunkSize);
    //   await SerialWrite(`f.write('''${chunk}''')`);
    //   await SerialWrite(`\r\n`);
    //   // await sleep(100); // give REPL time
    // }
    // await SerialWrite("f.close()\r\n");
    let buffer = "";
    for (let line of lines) {
      if ((buffer + line).length > 800) {
        // send current buffer
        await SerialWrite(`f.write('''${buffer}''')`);
        await SerialWrite(`\r\n`);
        buffer = "";
      }
      buffer += line;
    }
    // send remaining buffer if any
    if (buffer.length > 0) {
      await SerialWrite(`f.write('''${buffer}''')`);
      await SerialWrite(`\r\n`);
    }
    await SerialWrite("f.close()\r\n");
    document.getElementById("popup").textContent = popupTitle;
    showPopup(popupBackground);
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

function renumberRegisterBlockRows(regDict) {
  const tbody =
    regDict === "PYTRO_DMM_REGDICT"
      ? document.getElementById("DMMregisterBlockBody")
      : regDict === "PYTRO_RMM4_REGDICT"
      ? document.getElementById("RMM4registerBlockBody")
      : regDict === "PYTRO_ODIN_O2_CAGES"
      ? document.getElementById("ODINO2registerBlockBody")
      : document.getElementById("MRH4registerBlockBody");
  const rows = tbody.querySelectorAll("tr");
  rows.forEach((row, index) => {
    const blockNumber = index + 1;
    const blockPrefix = `${regDict}.${blockNumber}`;
    const inputs = row.querySelectorAll("input, select");
    const cells = row.querySelectorAll("td");
    // Update block number cell
    cells[0].innerText = blockNumber;
    // Update name attributes
    if (regDict === "PYTRO_DMM_REGDICT" || regDict === "PYTRO_RMM4_REGDICT") {
      inputs[0].name = `${blockPrefix}.OFFSET`;
      inputs[1].name = `${blockPrefix}.NUMREG`;
      inputs[2].name = `${blockPrefix}.FORMAT`;
    } else if (regDict === "PYTRO_MRH4_REGDICT") {
      // For MRH4, use OFFSET and NODE_ID
      inputs[0].name = `${blockPrefix}.OFFSET`;
      inputs[1].name = `${blockPrefix}.NODE_ID`;
    } else if (regDict === "PYTRO_ODIN_O2_CAGES") {
      inputs[0].name = `${blockPrefix}.FLOWMETER_ID`;
      inputs[1].name = `${blockPrefix}.O2_ID`;
      inputs[2].name = `${blockPrefix}.VOUT`;
    }
  });
}

function addRegisterBlockRow(regDict) {
  const tbody =
    regDict === "PYTRO_DMM_REGDICT"
      ? document.getElementById("DMMregisterBlockBody")
      : regDict === "PYTRO_RMM4_REGDICT"
      ? document.getElementById("RMM4registerBlockBody")
      : regDict === "PYTRO_ODIN_O2_CAGES"
      ? document.getElementById("ODINO2registerBlockBody")
      : document.getElementById("MRH4registerBlockBody");
  const rows = tbody.querySelectorAll("tr");
  const newRowIndex = tbody.rows.length + 1;
  const blockKey = `${regDict}.${newRowIndex}`;
  // Compute new OFFSET based on previous row
  let newOffset = "";
  if (rows.length > 0 && regDict !== "PYTRO_MRH4_REGDICT" && regDict !== "PYTRO_ODIN_O2_CAGES") {
    const lastRow = rows[rows.length - 1];
    const lastOffsetInput = lastRow.querySelector("input[name$='.OFFSET']");
    const lastNumregInput = lastRow.querySelector("input[name$='.NUMREG']");
    const lastOffset = parseInt(lastOffsetInput?.value || "0", 10);
    const lastNumreg = parseInt(lastNumregInput?.value || "0", 10);
    if (!isNaN(lastOffset) && !isNaN(lastNumreg)) {
      newOffset = lastOffset + lastNumreg;
    }
  }
  const newRow = document.createElement("tr");
  if (regDict === "PYTRO_MRH4_REGDICT") {
    // For MRH4, use OFFSET and NODE_ID
    newRow.innerHTML = `
      <td>${newRowIndex}</td>
      <td><input type="text" class="form-control" name="${blockKey}.OFFSET" value="${newOffset}"></td>
      <td><input type="text" class="form-control" name="${blockKey}.NODE_ID" value=""></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, '${regDict}')"><i class="fa fa-minus-circle"></i></button></td>
    `;
  } else if (regDict === "PYTRO_ODIN_O2_CAGES") {
     newRow.innerHTML = `
      <td>${newRowIndex}</td>
      <td><input type="text" class="form-control" name="${blockKey}.FLOWMETER_ID" value="${newOffset}"></td>
      <td><input type="text" class="form-control" name="${blockKey}.O2_ID" value=""></td>
      <td><input type="text" class="form-control" name="${blockKey}.VOUT" value=""></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, '${regDict}')"><i class="fa fa-minus-circle"></i></button></td>
    `;
  } else {
    newRow.innerHTML = `
    <td>${newRowIndex}</td>
    <td><input type="text" class="form-control" name="${blockKey}.OFFSET" value="${newOffset}"></td>
    <td><input type="text" class="form-control numreg-input" name="${blockKey}.NUMREG" value=""></td>
    <td>
      <select class="form-control" name="${blockKey}.FORMAT">
        <option value="">Select Format</option>
        <option value="UInt16">UInt16</option>
        <option value="UInt32">UInt32</option>
        <option value="Float">Float</option>
      </select>
    </td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, '${regDict}')"><i class="fa fa-minus-circle"></i></button></td>
  `;
  }
  tbody.appendChild(newRow);
  renumberRegisterBlockRows(regDict);
  // Add JS validation in case the user manually types more than 50
  if (regDict !== "PYTRO_MRH4_REGDICT" && regDict !== "PYTRO_ODIN_O2_CAGES") {
    const numregInput = newRow.querySelector(".numreg-input");
    numregInput.addEventListener("input", () => {
      if (parseInt(numregInput.value) > 50) {
        numregInput.value = 50;
      }
    });
  }
  const offsetInput = newRow.querySelector('input[name$=".OFFSET"]');
  offsetInput.addEventListener("input", () => {
    const offsetInputValue = offsetInput.value;
    if (offsetInputValue < newOffset) {
      offsetValueForError = newOffset;
      document.getElementById("offsetValueError").innerText =
        offsetValueForError;
      document.getElementById("submitInEditModal").disabled = true;
      // document.getElementById("AddBlockInEditModal").disabled = true;
      document.querySelectorAll(".AddBlockInEditModal").forEach((button) => {
        button.disabled = true;
      });
      document.getElementById("offsetErrorContainer").style.display = "flex";
    } else {
      offsetValueForError = 0;
      document.getElementById("submitInEditModal").disabled = false;
      // document.getElementById("AddBlockInEditModal").disabled = false;
      document.querySelectorAll(".AddBlockInEditModal").forEach((button) => {
        button.disabled = false;
      });
      document.getElementById("offsetErrorContainer").style.display = "none";
    }
  });
}

function addEventBlockRow() {
  const tbody = document.getElementById("eventBlockBody");
  const newRow = document.createElement("tr");
  newRow.innerHTML = `
    <td><input type="text" class="form-control event-index-input" value=""></td>
    <td>
      <select class="form-select event-field event-select">
        <option value="" disabled selected>Select EVENT</option>
        <option value="RISING_EDGE">RISING_EDGE</option>
        <option value="FALLING_EDGE">FALLING_EDGE</option>
        <option value="EQUAL">EQUAL</option>
        <option value="ONCHANGE">ONCHANGE</option>
        <option value="HIGHER">HIGHER</option>
        <option value="HIGHEREQ">HIGHEREQ</option>
        <option value="LOWER">LOWER</option>
        <option value="LOWEREQ">LOWEREQ</option>
      </select>
    </td>
    <td><input type="text" class="form-control event-field prev-value" value=""></td>
    <td><input type="text" class="form-control event-field curr-value" value=""></td>
    <td><input type="text" class="form-control event-field upd-reg" value=""></td>
    <td><input type="text" class="form-control event-field upd-value" value=""></td>
    <td>
      <select class="form-select event-field action-select">
        <option value="" disabled selected>Select ACTION</option>
        <option value="PUSH">Push</option>
        <option value="UPDATE_PUSH">Update & Push</option>
        <option value="TEST">Test</option>
      </select>
    </td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="removeEventBlockRow(this)"><i class="fa fa-minus-circle"></i></button></td>
  `;
  tbody.appendChild(newRow);
  // Add the onchange handler to the newly created EVENT select
  const eventSelect = newRow.querySelector(".event-select");
  const actionSelect = newRow.querySelector(".action-select");
  const prevInput = newRow.querySelector(".prev-value");
  const currInput = newRow.querySelector(".curr-value");
  const updReg = newRow.querySelector(".upd-reg");
  const updVal = newRow.querySelector(".upd-value");

  eventSelect.addEventListener("change", function () {
    const event = this.value;
    // Reset all fields to editable and blank first
    prevInput.readOnly = false;
    currInput.readOnly = false;
    prevInput.value = "";
    currInput.value = "";
    if (event === "RISING_EDGE" || event === "FALLING_EDGE") {
      prevInput.value = "N/A";
      currInput.value = "N/A";
      prevInput.readOnly = true;
      currInput.readOnly = true;
    } else if (
      event === "EQUAL" ||
      event === "HIGHER" ||
      event === "LOWER" ||
      event === "HIGHEREQ" ||
      event === "LOWEREQ"
    ) {
      prevInput.value = "N/A";
      prevInput.readOnly = true;
      currInput.readOnly = false;
    } else if (event === "ONCHANGE") {
      // Leave both inputs editable and empty
      prevInput.value = "ANY";
      currInput.value = "ANY";
      prevInput.readOnly = false;
      currInput.readOnly = false;
    }
  });
  actionSelect.addEventListener("change", function () {
    const action = this.value;
    updReg.readOnly = false;
    updVal.readOnly = false;
    updReg.value = "";
    updVal.value = "";
    if (action === "PUSH" || action === "TEST") {
      updReg.value = "N/A";
      updVal.value = "N/A";
      updReg.readOnly = true;
      updVal.readOnly = true;
    } else {
      updReg.readOnly = false;
      updVal.readOnly = false;
    }
  });
}

function removeRegisterBlockRow(button, regDict) {
  const row = button.closest("tr");
  if (row) row.remove();
  renumberRegisterBlockRows(regDict);
}

function removeEventBlockRow(button) {
  const row = button.closest("tr");
  if (row) row.remove();
}

let mmrBlockIndex = 1;

function updateMMRBlockTitles() {
  document.querySelectorAll(".mmr-block").forEach((block, i) => {
    const title = block.querySelector(".mmr-block-title");
    if (title) {
      title.textContent = `Block ${i + 1}`;
    }
  });
}

function addMMRBlock() {
  const container = document.getElementById("MMRBlocksContainer");
  const blockKey = mmrBlockIndex++;

  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="card mb-3 p-0 mmr-block" id="mmr-block-${blockKey}" data-block-key="${blockKey}">
      <div class="card-header d-flex justify-content-between align-items-center">
        <strong class="mmr-block-title"></strong>
        <button class="btn btn-sm btn-danger"
                onclick="removeMMRBlock(this)">
          <i class="fa fa-trash"></i>
        </button>
      </div>

      <div class="card-body">

        <!-- Inline Form -->
        <div class="d-flex gap-2 align-items-center mb-2 mmr-register-row w-100">
          <div class="form-floating w-100">
            <select class="form-select form-select-sm" id="fncSelect-${blockKey}">
              <option value="" disabled selected>Function</option>
              <option value="1">0x1</option>
              <option value="2">0x2</option>
              <option value="3">0x3</option>
              <option value="4">0x4</option>
            </select>
            <label for="fncSelect-${blockKey}">Select Function</label>
          </div>
          <div class="form-floating w-100">
            <input class="form-control form-control-sm" id="startOffset-${blockKey}">
            <label for="startOffset-${blockKey}">Start offset</label>
          </div>
          <div class="form-floating w-100">
            <input class="form-control form-control-sm" id="numReg-${blockKey}">
            <label for="numReg-${blockKey}">Num Registers</label>
          </div>
          <div class="form-floating w-100">
            <select class="form-select form-select-sm" id="formatSelect-${blockKey}">
              <option value="" disabled selected>Format</option>
              <option value="bits" disabled>Bits</option>
              <option value="Uint16">UInt16</option>
              <option value="Uint32">UInt32</option>
              <option value="float_big_endian">Float Big Endian</option>
              <option value="float_little_endian">Float Little Endian</option>
              <option value="float_big_endian_byte_swapped">Float Big Endain Byte Swapped</option>
              <option value="float_little_endian_byte_swapped">Float Little Endian Byte Swapped</option>
            </select>
            <label for="formatSelect-${blockKey}">Select Format</label>
          </div>

          <button class="btn btn-success btn-sm"
                  onclick="generateMMRTable(this)">
            Generate
          </button>
        </div>

        <!-- Table container -->
        <div class="mmr-table-container"></div>

      </div>
    </div>
  `
  );
  // Apply rules on function change
  const fncSelect = document.getElementById(`fncSelect-${blockKey}`);
  fncSelect.addEventListener("change", () =>
    applyFncFormatRules(blockKey)
  );
  updateMMRBlockTitles();
}

// function limited the decimal number to be 0, 1 or 2 only
function limitDecimal(input) {
  let val = parseInt(input.value, 10);

  if (isNaN(val)) {
    input.value = 0;
    return;
  }

  if (val < 0) input.value = 0;
  else if (val > 2) input.value = 2;
}

function generateMMRTable(btn) {
  const blockCard = btn.closest(".mmr-block");
  const row = blockCard.querySelector(".mmr-register-row");
  const tableContainer = blockCard.querySelector(".mmr-table-container");

  const selects = row.querySelectorAll("select");
  const inputs = row.querySelectorAll("input");

  const FUNCTION = selects[0]?.value;
  const FORMAT = selects[1]?.value;
  const START_OFFSET = parseInt(inputs[0]?.value, 10);
  const NUMREG = parseInt(inputs[1]?.value, 10);

  if (!FUNCTION || !FORMAT || isNaN(START_OFFSET) || isNaN(NUMREG)) {
    document.getElementById("popup").textContent =
      "Please fill all block fields";
    showPopup("rgba(205, 9, 9, 0.8)");
    return;
  }

  const showDecimal = FORMAT === "Uint16" || FORMAT === "Uint32";
  const step = (FORMAT === "Uint16" || FORMAT === "bits") ? 1 : 2;
  let bodyHtml = "";
  for (let i = 0; i < NUMREG; i++) {
    const offset = START_OFFSET + i * step;

    bodyHtml += `
      <tr class="register-row" data-offset="${offset}">
        <td>${offset}</td>
        <td><input class="form-control form-control-sm" value="${FORMAT}" disabled></td>
        <td><input class="form-control form-control-sm" id="name-${offset}" placeholder="Name"></td>
        ${
          showDecimal
            ? `
          <td><input type="number" class="form-control form-control-sm" id="decimal-${offset}" value="0" min="0" max="2" step="1" placeholder="Decimal" oninput="limitDecimal(this)"></td>`
            : ``
        }
        <td><input class="form-control form-control-sm" value="${FUNCTION}" disabled></td>
        <td><input class="form-control form-control-sm" id="description-${offset}" placeholder="Description"></td>
      </tr>
    `;
  }

  tableContainer.innerHTML = `
    <table class="table table-bordered table-sm">
      <thead>
        <tr>
          <th>Offset</th>
          <th>Format</th>
          <th>Name</th>
          ${showDecimal ? `<th>Decimal</th>` : ``}
          <th>Function</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${bodyHtml}
      </tbody>
    </table>
  `;
}

function removeMMRBlock(btn) {
  const block = btn.closest(".mmr-block");
  if (!block) return;

  block.remove();
  updateMMRBlockTitles();
}

function toggleRegisterVisibility(blockKey) {
  const rows = document.getElementById(`registers-${blockKey}`);
  const regenBtn = document.getElementById(`regenBtn-${blockKey}`);
  const editHideBtn = document.getElementById(`editHideBtn-${blockKey}`);
  const visible = rows.style.display === "block";
  rows.style.display = visible ? "none" : "block";
  regenBtn.style.display = visible ? "none" : "inline-block";
  editHideBtn.innerHTML = visible ? ' <i class="fa fa-edit"></i> Edit' : '<i class="fa fa-eye-slash "></i> Hide';
}

function regenerateRegisters(blockKey) {
  const block = document.getElementById(`mmr-block-${blockKey}`);
  if (!block) return;

  const numRegInput = block.querySelector(`#numReg-${blockKey}`);
  const startOffsetInput = block.querySelector(`#startOffset-${blockKey}`);
  const formatSelect = block.querySelector(`#formatSelect-${blockKey}`);
  const fncSelect = block.querySelector(`#fncSelect-${blockKey}`);

  const newNumReg = parseInt(numRegInput.value, 10);
  const startOffset = parseInt(startOffsetInput.value, 10);
  const FORMAT = formatSelect.value;
  const FNC = fncSelect?.value || "";

  if (isNaN(newNumReg) || isNaN(startOffset) || !FORMAT) return;

  const step = (FORMAT === "Uint16" || FORMAT === "bits") ? 1 : 2;
  const registersContainer = document.getElementById(`registers-${blockKey}`);

  // Clear old registers
  registersContainer.innerHTML = "";

  for (let i = 0; i < newNumReg; i++) {
    const offset = startOffset + i * step;

    registersContainer.insertAdjacentHTML(
      "beforeend",
      `
      <div class="mb-2 register-row" data-offset="${offset}">
        <div class="d-flex gap-2 align-items-center">

          <!-- Offset -->
          <div class="form-floating w-100">
            <input class="form-control" value="${offset}" disabled>
            <label>Offset</label>
          </div>

          <!-- Format (display only) -->
          <div class="form-floating w-100">
            <input class="form-control" value="${FORMAT}" disabled>
            <label>Format</label>
          </div>

          <!-- Name -->
          <div class="form-floating w-100">
            <input class="form-control" name="name-${offset}" id="name-${offset}" placeholder="Name">
            <label>Name</label>
          </div>

          <!-- Decimal point -->
          ${
            FORMAT === "Uint16" || FORMAT === "Uint32"
              ? `
                <div class="form-floating w-100">
                  <input class="form-control"
                        type="number"
                        min="0" 
                        max="2" 
                        step="1"
                        oninput="limitDecimal(this)"
                        name="decimal-${offset}"
                        id="decimal-${offset}">
                  <label>Decimal Point</label>
                </div>
              `
              : ``
          }

          <!-- Function (display only) -->
          <div class="form-floating w-100">
            <input class="form-control" value="${FNC}" disabled>
            <label>Function</label>
          </div>
          
          <!-- Description -->
          <div class="form-floating w-100">
            <input class="form-control" name="description-${offset}" id="description-${offset}" placeholder="Description">
            <label>Description</label>
          </div>
        </div>
      </div>
    `
    );
  }
}

function removeMMRRow(btn) {
  const block = btn.closest(".mmr-block");
  if (!block) return;
  block.remove();
}

// function for format rules when fnc selected 
function applyFncFormatRules(blockKey) {
  const fncSelect = document.getElementById(`fncSelect-${blockKey}`);
  const formatSelect = document.getElementById(`formatSelect-${blockKey}`);
  if (!fncSelect || !formatSelect) return;

  const fnc = Number(fncSelect.value);

  const isBitsOnly = fnc === 1 || fnc === 2;

  [...formatSelect.options].forEach(opt => {
    if (opt.value === "bits") {
      opt.disabled = !isBitsOnly;
    } else {
      opt.disabled = isBitsOnly;
    }
  });

  if (isBitsOnly) {
    formatSelect.value = "bits";
    formatSelect.disabled = true;
  } else {
    if (formatSelect.value === "bits") {
      formatSelect.value = "";
    }
    formatSelect.disabled = false;
  }
}

/************************************ helpers for MMR excel import ************************************/
// Import function
function importMMRFromExcel(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ""
    });

    processMMRExcelRows(rows);
  };

  reader.readAsArrayBuffer(file);
  input.value = ""; // reset input
}

// Split blocks by empty rows
function processMMRExcelRows(rows) {
  const header = rows[0].map(h => h.toString().toLowerCase().trim());
  const dataRows = rows.slice(1);

  const blocks = [];
  let currentBlock = [];

  dataRows.forEach(row => {
    const isEmpty = row.every(cell => cell === "");

    if (isEmpty) {
      if (currentBlock.length) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    } else {
      currentBlock.push(row);
    }
  });

  if (currentBlock.length) blocks.push(currentBlock);

  blocks.forEach(blockRows => buildMMRBlockFromExcel(header, blockRows));
  updateMMRBlockTitles();
}

// Convert one Excel block → one MMR block without Generate
function buildMMRBlockFromExcel(header, rows) {
  addMMRBlock();
  const blockKey = mmrBlockIndex - 1;
  const block = document.getElementById(`mmr-block-${blockKey}`);

  const col = (name) => header.indexOf(name);

  // Extract values from first row
  const fnc = Number(rows[0][col("function")]);
  const format = rows[0][col("format")];

  // Set block fields
  block.querySelector(`#fncSelect-${blockKey}`).value = fnc;
  block.querySelector(`#formatSelect-${blockKey}`).value = format;

  const offsets = rows.map(r => Number(r[col("start offset")]));
  block.querySelector(`#startOffset-${blockKey}`).value = Math.min(...offsets);
  block.querySelector(`#numReg-${blockKey}`).value = rows.length;

  applyFncFormatRules(blockKey);

  // 🔥 Inject registers directly
  injectRegisterRowsFromExcel(blockKey, rows, header);
}

// Inject register rows explicitly
function injectRegisterRowsFromExcel(blockKey, rows, header) {
  const block = document.getElementById(`mmr-block-${blockKey}`);
  const container = block.querySelector(".mmr-table-container");

  const col = (name) => header.indexOf(name);
  const format = rows[0][col("format")];
  const fnc = rows[0][col("function")];

  const showDecimal = format === "Uint16" || format === "Uint32";

  let bodyHtml = "";

  rows.forEach(row => {
    const offset = Number(row[col("start offset")]);
    const name = row[col("name")];
    const desc = row[col("description")];

    bodyHtml += `
      <tr class="register-row" data-offset="${offset}">
        <td>${offset}</td>
        <td><input class="form-control form-control-sm" value="${format}" disabled></td>
        <td><input class="form-control form-control-sm" id="name-${offset}" value="${name}"></td>
        ${
          showDecimal
            ? `<td>
                 <input type="number"
                        class="form-control form-control-sm"
                        id="decimal-${offset}"
                        value="0"
                        min="0"
                        max="2"
                        step="1"
                        oninput="limitDecimal(this)">
               </td>`
            : ""
        }
        <td><input class="form-control form-control-sm" value="${fnc}" disabled></td>
        <td><input class="form-control form-control-sm" id="description-${offset}" value="${desc}"></td>
      </tr>
    `;
  });

  container.innerHTML = `
    <table class="table table-bordered table-sm">
      <thead>
        <tr>
          <th>Offset</th>
          <th>Format</th>
          <th>Name</th>
          ${showDecimal ? "<th>Decimal</th>" : ""}
          <th>Function</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
}

// edit app fields
function editApp(appKey) {
  document.getElementById("editAppsModal").style.display = "flex";

  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
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

      const fields = app[appKey];
      const name = fields.NAME || appKey.replaceAll("_", " ");
      const regularFields = [];
      const regDictNestedTables = [];
      const eventDictNestedTables = [];
      document.getElementById(
        "editAppTitle"
      ).innerHTML = `<span class="app-key-highlight">${name}</span> Application`;

      // --- Handle PYTRO_DMM REGDICT / EVENTDICT ---
      if (appKey === "PYTRO_DMM") {
        try {
          const regDict = fields.PYTRO_DMM_REGDICT;
          const eventDict = fields.PYTRO_DMM_EVENTDICT;

          Object.keys(regDict).forEach((blockKey) => {
            const block = regDict[blockKey];
            const { OFFSET, NUMREG, FORMAT } = block;

            regDictNestedTables.push(`
              <tr>
                <td><strong>${blockKey}</strong></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_DMM_REGDICT.${blockKey}.OFFSET" value="${OFFSET}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_DMM_REGDICT.${blockKey}.NUMREG" value="${NUMREG}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_DMM_REGDICT.${blockKey}.FORMAT" value="${FORMAT}"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, 'PYTRO_DMM_REGDICT')"><i class="fa fa-minus-circle"></i></button></td>
              </tr>
            `);
          });

          Object.keys(eventDict).forEach((offsetKey) => {
            const indexedEvents = eventDict[offsetKey];

            Object.keys(indexedEvents).forEach((indexKey) => {
              const {
                EVENT,
                PREV_VAL,
                CURRENT_VAL,
                UPDATE_REG,
                UPDATE_VAL,
                ACTION,
              } = indexedEvents[indexKey];
              const conditionLabel = `${parseInt(indexKey)}`;

              eventDictNestedTables.push(`
                <tr>
                  <td><input type="text" class="form-control event-index-input" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}" value="${offsetKey}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.EVENT" value="${EVENT}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.PREV_VAL" value="${PREV_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.CURRENT_VAL" value="${CURRENT_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.UPDATE_REG" value="${UPDATE_REG}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.UPDATE_VAL" value="${UPDATE_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_DMM_EVENTDICT.${offsetKey}.${indexKey}.ACTION" value="${ACTION}"></td>
                  <td><button type="button" class="btn btn-sm btn-danger" onclick="removeEventBlockRow(this)"><i class="fa fa-minus-circle"></i></button></td>
                </tr>
              `);
            });
          });
        } catch (error) {
          console.error(
            "Error parsing PYTRO_DMM_REGDICT or PYTRO_DMM_EVENTDICT:",
            error
          );
        }
      }
      if (appKey === "PYTRO_RMM4") {
        try {
          const regDict = fields.PYTRO_RMM4_REGDICT;

          Object.keys(regDict).forEach((blockKey) => {
            const block = regDict[blockKey];
            const { OFFSET, NUMREG, FORMAT } = block;

            regDictNestedTables.push(`
              <tr>
                <td><strong>${blockKey}</strong></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_RMM4_REGDICT.${blockKey}.OFFSET" value="${OFFSET}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_RMM4_REGDICT.${blockKey}.NUMREG" value="${NUMREG}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_RMM4_REGDICT.${blockKey}.FORMAT" value="${FORMAT}"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, 'PYTRO_RMM4_REGDICT')"><i class="fa fa-minus-circle"></i></button></td>
              </tr>
            `);
          });
        } catch (error) {
          console.error("Error parsing PYTRO_RMM4_REGDICT:", error);
        }
      }
      if (appKey === "PYTRO_MRH4") {
        try {
          const regDict = fields.PYTRO_MRH4_REGDICT;

          Object.keys(regDict).forEach((blockKey) => {
            const block = regDict[blockKey];
            const { OFFSET, NODE_ID } = block;

            regDictNestedTables.push(`
              <tr>
                <td><strong>${blockKey}</strong></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_MRH4_REGDICT.${blockKey}.OFFSET" value="${OFFSET}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_MRH4_REGDICT.${blockKey}.NODE_ID" value="${NODE_ID}"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, 'PYTRO_MRH4_REGDICT')"><i class="fa fa-minus-circle"></i></button></td>
              </tr>
            `);
          });
        } catch (error) {
          console.error("Error parsing PYTRO_MRH4_REGDICT:", error);
        }
      }
      if (appKey === "PYTRO_MMR") {
        try {
          const mmrMetadata = data.MMR_METADATA || {};
          const regDict = fields.PYTRO_MMR_REGDICT ?? {};
          const eventDict = fields.PYTRO_MMR_EVENTDICT ?? {};
          // const eventDict = fields.PYTRO_MMR_EVENTDICT;
          // ✅ Initialize global index safely
          const existingKeys = Object.keys(regDict).map(Number);
          mmrBlockIndex = existingKeys.length
            ? Math.max(...existingKeys) + 1
            : 1;
          // Loop through each block in saved data
          Object.entries(regDict).forEach(([blockKey, block]) => {
            const { fnc, start, numReg, format } = block;
            const isUInt = format === "Uint16" || format === "Uint32";
            /* Build registers safely */
            let registers = {};
            if (isUInt && block.regDict && Object.keys(block.regDict).length) {
              // Uint formats → use saved regDict
              registers = block.regDict;
            } else {
              // Non-uint formats → generate offsets
              const step = (format === "Uint16" || format === "bits") ? 1 : 2;
              for (let i = 0; i < numReg; i++) {
                const offset = start + i * step;
                registers[offset] = null; // no decimal
              }
            }

            // Add the block UI (fnc, start, numReg, format are displayed initially)
            regDictNestedTables.push(`
              <div class="mmr-block" id="mmr-block-${blockKey}" data-block-key="${blockKey}">
                <!-- Block Settings: Function, Start, Num Reg, Format -->
                <div class="d-flex align-items-center gap-2 mb-2">
                <!-- Block number -->
                <strong class="mmr-block-title w-30"></strong>
                <!-- Function -->
                <div class="form-floating w-100">
                  <select class="form-select" id="fncSelect-${blockKey}" onchange="applyFncFormatRules('${blockKey}')">
                    <option value="1" ${
                      fnc === 1 ? "selected" : ""
                    }>0x01</option>
                    <option value="2" ${
                      fnc === 2 ? "selected" : ""
                    }>0x02</option>
                    <option value="3" ${
                      fnc === 3 ? "selected" : ""
                    }>0x03</option>
                    <option value="4" ${
                      fnc === 4 ? "selected" : ""
                    }>0x04</option>
                  </select>
                  <label for="fncSelect-${blockKey}">Selected Function</label>
                </div>
                  <!-- Start -->
                  <div class="form-floating w-100">
                    <input class="form-control" id="startOffset-${blockKey}" value="${start}">
                    <label for="startOffset-${blockKey}">Started offset</label>
                  </div>
                  <!-- Num Reg -->
                  <div class="form-floating w-100">
                    <input class="form-control" id="numReg-${blockKey}" value="${numReg}">
                    <label for="numReg-${blockKey}">Num Registers</label>
                  </div>
                  <!-- Format -->
                  <div class="form-floating w-100">
                    <select class="form-select" id="formatSelect-${blockKey}">
                    <option value="bits" ${format === "bits" ? "selected" : ""}>Bits</option>
                      <option value="Uint16" ${
                        format === "Uint16" ? "selected" : ""
                      }>Uint16</option>
                      <option value="Uint32" ${
                        format === "Uint32" ? "selected" : ""
                      }>Uint32</option>
                      <option value="float_big_endian" ${
                        format === "float_big_endian" ? "selected" : ""
                      }>Float Big Endian</option>
                      <option value="float_little_endian" ${
                        format === "float_little_endian" ? "selected" : ""
                      }>Float Little Endian</option>
                      <option value="float_big_endian_byte_swapped" ${
                        format === "float_big_endian_byte_swapped"
                          ? "selected"
                          : ""
                      }>Float Big Endain Byte Swapped</option>
                      <option value="float_little_endian_byte_swapped" ${
                        format === "float_little_endian_byte_swapped"
                          ? "selected"
                          : ""
                      }>Float Little Endian Byte Swapped</option>
                    </select>
                    <label for="formatSelect-${blockKey}">Selected Format</label>
                  </div>
                  <!-- Edit Button -->
                  <button class="btn btn-primary w-30" id="editHideBtn-${blockKey}" onclick="toggleRegisterVisibility('${blockKey}')">
                    <i class="fa fa-edit"></i> Edit
                  </button>
                  <!-- Regenerate Button (hidden initially) -->
                  <button class="btn btn-warning w-60" id="regenBtn-${blockKey}" onclick="regenerateRegisters('${blockKey}')" style="display: none;">
                    <i class="fa fa-refresh"></i> Regenerate
                  </button>
                  <!-- Remove Button -->
                  <button class="btn btn-danger" onclick="removeMMRRow(this)">
                    <i class="fa fa-trash"></i>
                  </button>
                </div>

                <!-- Register Rows (Initially hidden) -->
                <div class="register-rows" id="registers-${blockKey}" style="display: none;">
                  ${Object.entries(registers)
                    .map(([offset, reg]) => {
                      const decimal = typeof reg === "number" ? reg : undefined;
                      const showDecimal = typeof decimal === "number";

                      // ✅ READ METADATA
                      const meta =
                        mmrMetadata?.[blockKey]?.[offset] || {};

                      const name = meta.name || "";
                      const description = meta.description || "";
                      return `
                      <div class="mb-2 register-row" data-offset="${offset}">
                        <div class="d-flex gap-2 align-items-center">

                          <!-- Offset -->
                          <div class="form-floating w-100">
                            <input class="form-control" value="${offset}" id="offset-${offset}" disabled>
                            <label for="offset-${offset}">Start offset</label>
                          </div>

                          <!-- Format -->
                          <div class="form-floating w-100">
                            <input class="form-control" value="${format}" disabled>
                            <label>Format</label>
                          </div>

                          <!-- Name -->
                          <div class="form-floating w-100">
                            <input class="form-control" name="name-${offset}" id="name-${offset}" value="${name}">
                            <label for="name-${offset}">Name</label>
                          </div>

                          ${
                            showDecimal
                              ? `
                          <!-- Decimal point -->
                          <div class="form-floating w-100">
                            <input class="form-control"
                                  type="number"
                                  min="0" 
                                  max="2" 
                                  step="1"
                                  oninput="limitDecimal(this)"
                                  name="decimal-${offset}"
                                  id="decimal-${offset}"
                                  value="${decimal}">
                            <label for="decimal-${offset}">Decimal Point</label>
                          </div>
                          `
                              : ``
                          }

                          <!-- Function -->
                          <div class="form-floating w-100">
                            <input class="form-control" value="0x${fnc
                              .toString(16)
                              .padStart(2, "0")}" disabled>
                            <label>Function</label>
                          </div>

                          <!-- Description -->
                          <div class="form-floating w-100">
                            <input class="form-control" name="description-${offset}" id="description-${offset}" value="${description}">
                            <label for="description-${offset}">Description</label>
                          </div>
                        </div>
                      </div>
                    `;
                    })
                    .join("")}
                </div>
              </div>
            `);
            setTimeout(() => applyFncFormatRules(blockKey), 0);
          });

          // for MMR evendict
          Object.keys(eventDict).forEach((offsetKey) => {
            const indexedEvents = eventDict[offsetKey];

            Object.keys(indexedEvents).forEach((indexKey) => {
              const {
                EVENT,
                PREV_VAL,
                CURRENT_VAL,
                UPDATE_REG,
                UPDATE_VAL,
                ACTION,
              } = indexedEvents[indexKey];
              const conditionLabel = `${parseInt(indexKey)}`;

              eventDictNestedTables.push(`
                <tr>
                  <td><input type="text" class="form-control event-index-input" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}" value="${offsetKey}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.EVENT" value="${EVENT}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.PREV_VAL" value="${PREV_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.CURRENT_VAL" value="${CURRENT_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.UPDATE_REG" value="${UPDATE_REG}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.UPDATE_VAL" value="${UPDATE_VAL}"></td>
                  <td><input type="text" class="form-control event-field" disabled name="PYTRO_MMR_EVENTDICT.${offsetKey}.${indexKey}.ACTION" value="${ACTION}"></td>
                  <td><button type="button" class="btn btn-sm btn-danger" onclick="removeEventBlockRow(this)"><i class="fa fa-minus-circle"></i></button></td>
                </tr>
              `);
            });
          });
        } catch (error) {
          console.error(
            "Error parsing PYTRO_MMR_REGDICT or PYTRO_MMR_EVENTDICT:",
            error
          );
        }
      }
      if (appKey === "PYTRO_ODIN_O2") {
        try {
          const regDict = fields.PYTRO_ODIN_O2_CAGES;

          Object.keys(regDict).forEach((blockKey) => {
            const block = regDict[blockKey];
            const { FLOWMETER_ID, O2_ID, VOUT } = block;

            regDictNestedTables.push(`
              <tr>
                <td><strong>${blockKey}</strong></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_ODIN_O2_CAGES.${blockKey}.FLOWMETER_ID" value="${FLOWMETER_ID}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_ODIN_O2_CAGES.${blockKey}.O2_ID" value="${O2_ID}"></td>
                <td><input type="text" class="form-control" disabled name="PYTRO_ODIN_O2_CAGES.${blockKey}.VOUT" value="${VOUT}"></td>
                <td><button type="button" class="btn btn-sm btn-danger" onclick="removeRegisterBlockRow(this, 'PYTRO_ODIN_O2_CAGES')"><i class="fa fa-minus-circle"></i></button></td>
              </tr>
            `);
          });
        } catch (error) {
          console.error(
            "Error parsing PYTRO_ODIN_O2_CAGES: ",
            error
          );
        }
      }

      // --- Generate editable input fields ---
      for (const [key, value] of Object.entries(fields)) {
        if (
          key.startsWith(appKey + "_") &&
          key !== `${appKey}_ENABLE` &&
          key !== `${appKey}_HARDWARE`
        ) {
          const labelName = key.replaceAll("_", " ");
          let inputHtml = "";

          if (typeof value === "object" && !Array.isArray(value)) continue;

          if (Array.isArray(value)) {
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
            inputHtml = `<select class="form-select flex-50" name="${key}" id="${key}">
              <option value="ON" ${value === "ON" ? "selected" : ""}>ON</option>
              <option value="OFF" ${
                value === "OFF" ? "selected" : ""
              }>OFF</option>
            </select>`;
          } else {
            inputHtml = `<input type="text" class="form-control flex-50" name="${key}" id="${key}" value="${value}">`;
          }

          regularFields.push(`
            <div class="mb-3 d-flex justify-content-between align-items-center">
              <label class="flex-50 text-start">${labelName}</label>
              ${inputHtml}
            </div>
          `);
        }
      }

      let formHtml = `
        <div class="d-flex justify-content-between align-items-center">
          <input type="hidden" id="editAppKey" value="${appKey}" />
        </div>
      `;

      if (appKey === "PYTRO_DMM") {
        // --- PYTRO_DMM tabbed layout ---
        formHtml += `
          <ul class="nav nav-tabs" id="editAppTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <a class="nav-link active" id="DMM-commonSettings-tab" data-bs-toggle="tab" href="#DMMcommonSettings" role="tab" aria-controls="DMMcommonSettings" aria-selected="true">Common Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="DMM-registerSettings-tab" data-bs-toggle="tab" href="#DMMregisterSettings" role="tab" aria-controls="DMMregisterSettings">Register Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="DMM-advancedSettings-tab" data-bs-toggle="tab" href="#DMMadvancedSettings" role="tab" aria-controls="DMMadvancedSettings">Advanced Settings</a>
            </li>
          </ul>
          <div class="tab-content mt-2" id="editAppTabsContent">
            <div class="tab-pane fade show active" id="DMMcommonSettings" role="tabpanel" aria-labelledby="DMM-commonSettings-tab">
              ${regularFields.join("")}
            </div>
            <div class="tab-pane fade" id="DMMregisterSettings" role="tabpanel" aria-labelledby="DMM-registerSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Register Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary AddBlockInEditModal" onclick="addRegisterBlockRow('PYTRO_DMM_REGDICT')"><i class="fa fa-plus-circle"></i> Add Block</button>
                </div>
                <table class="table table-bordered mt-2" id="registerBlockTable">
                  <thead>
                    <tr>
                      <th>Blocks</th>
                      <th>Offset</th>
                      <th>Num Reg</th>
                      <th>Format</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="DMMregisterBlockBody">
                    ${regDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="tab-pane fade" id="DMMadvancedSettings" role="tabpanel" aria-labelledby="DMM-advancedSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Event Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary" onclick="addEventBlockRow()"><i class="fa fa-plus-circle"></i> Add Event</button>
                </div>
                <table class="table table-bordered mt-2" id="eventBlockTable">
                  <thead>
                    <tr>
                      <th>Offset</th>
                      <th>Event</th>
                      <th>Previous Val</th>
                      <th>Current Val</th>
                      <th>Update Register</th>
                      <th>Update Value</th>
                      <th>Action</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="eventBlockBody">
                    ${eventDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else if (appKey === "PYTRO_RMM4") {
        // --- PYTRO_RMM4 tabbed layout ---
        formHtml += `
          <ul class="nav nav-tabs" id="editAppTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <a class="nav-link active" id="RMM4-commonSettings-tab" data-bs-toggle="tab" href="#RMM4commonSettings" role="tab" aria-controls="RMM4commonSettings" aria-selected="true">Common Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="RMM4-registerSettings-tab" data-bs-toggle="tab" href="#RMM4registerSettings" role="tab" aria-controls="RMM4registerSettings">Register Settings</a>
            </li>
          </ul>
          <div class="tab-content mt-2" id="editAppTabsContent">
            <div class="tab-pane fade show active" id="RMM4commonSettings" role="tabpanel" aria-labelledby="RMM4-commonSettings-tab">
              ${regularFields.join("")}
            </div>
            <div class="tab-pane fade" id="RMM4registerSettings" role="tabpanel" aria-labelledby="RMM4-registerSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Register Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary AddBlockInEditModal" onclick="addRegisterBlockRow('PYTRO_RMM4_REGDICT')"><i class="fa fa-plus-circle"></i> Add Block</button>
                </div>
                <table class="table table-bordered mt-2" id="registerBlockTable">
                  <thead>
                    <tr>
                      <th>Blocks</th>
                      <th>Offset</th>
                      <th>Num Reg</th>
                      <th>Format</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="RMM4registerBlockBody">
                    ${regDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else if (appKey === "PYTRO_MRH4") {
        // --- PYTRO_MRH4 tabbed layout ---
        formHtml += `
          <ul class="nav nav-tabs" id="editAppTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <a class="nav-link active" id="MRH4-commonSettings-tab" data-bs-toggle="tab" href="#MRH4commonSettings" role="tab" aria-controls="MRH4commonSettings" aria-selected="true">Common Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="MRH4-registerSettings-tab" data-bs-toggle="tab" href="#MRH4registerSettings" role="tab" aria-controls="MRH4registerSettings">Register Settings</a>
            </li>
          </ul>
          <div class="tab-content mt-2" id="editAppTabsContent">
            <div class="tab-pane fade show active" id="MRH4commonSettings" role="tabpanel" aria-labelledby="MRH4-commonSettings-tab">
              ${regularFields.join("")}
            </div>
            <div class="tab-pane fade" id="MRH4registerSettings" role="tabpanel" aria-labelledby="MRH4-registerSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Register Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary AddBlockInEditModal" onclick="addRegisterBlockRow('PYTRO_MRH4_REGDICT')"><i class="fa fa-plus-circle"></i> Add Block</button>
                </div>
                <table class="table table-bordered mt-2" id="registerBlockTable">
                  <thead>
                    <tr>
                      <th>Blocks</th>
                      <th>Offset</th>
                      <th>Node ID</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="MRH4registerBlockBody">
                    ${regDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else if (appKey === "PYTRO_MMR") {
        // --- PYTRO_MMR tabbed layout ---
        formHtml += `
          <ul class="nav nav-tabs" id="editAppTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <a class="nav-link active" id="MMR-commonSettings-tab" data-bs-toggle="tab" href="#MMRcommonSettings" role="tab" aria-controls="MMRcommonSettings" aria-selected="true">Common Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="MMR-registerSettings-tab" data-bs-toggle="tab" href="#MMRregisterSettings" role="tab" aria-controls="MMRregisterSettings">Register Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="MMR-advancedSettings-tab" data-bs-toggle="tab" href="#MMRadvancedSettings" role="tab" aria-controls="MMRadvancedSettings">Advanced Settings</a>
            </li>
          </ul>
          <div class="tab-content mt-2" id="editAppTabsContent">
            <!-- Common Settings -->
            <div class="tab-pane fade show active" id="MMRcommonSettings" role="tabpanel" aria-labelledby="MMR-commonSettings-tab">
              ${regularFields.join("")}
            </div>
            <!-- Register Settings -->
            <div class="tab-pane fade" id="MMRregisterSettings" role="tabpanel" aria-labelledby="MMR-registerSettings-tab">
              <div class="mb-2 d-flex justify-content-end gap-2">
                <button class="btn btn-primary mt-1"
                        onclick="addMMRBlock()">
                  <i class="fa fa-plus-circle"></i> Add Block
                </button>
                <button class="btn btn-info mt-1"
                        onclick="document.getElementById('mmrImportInput').click()">
                  <i class="fa fa-upload"></i> Import File
                </button>
                <input
                  type="file"
                  id="mmrImportInput"
                  accept=".xlsx,.xls"
                  style="display:none"
                  onchange="importMMRFromExcel(this)"
                />
              </div>
              <div id="MMRBlocksContainer">${regDictNestedTables.join(
                 ""
              )}</div>
            </div>
            <!-- Advanced Settings -->
            <div class="tab-pane fade" id="MMRadvancedSettings" role="tabpanel" aria-labelledby="MMR-advancedSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Event Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary" onclick="addEventBlockRow()"><i class="fa fa-plus-circle"></i> Add Event</button>
                </div>
                <table class="table table-bordered mt-2" id="eventBlockTable">
                  <thead>
                    <tr>
                      <th>Offset</th>
                      <th>Event</th>
                      <th>Previous Val</th>
                      <th>Current Val</th>
                      <th>Update Register</th>
                      <th>Update Value</th>
                      <th>Action</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="eventBlockBody">
                    ${eventDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else if (appKey === "PYTRO_ODIN_O2") {
        // --- PYTRO_ODIN_O2 tabbed layout ---
        formHtml += `
          <ul class="nav nav-tabs" id="editAppTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <a class="nav-link active" id="ODINO2-commonSettings-tab" data-bs-toggle="tab" href="#ODINO2commonSettings" role="tab" aria-controls="ODINO2commonSettings" aria-selected="true">Common Settings</a>
            </li>
            <li class="nav-item" role="presentation">
              <a class="nav-link" id="ODINO2-registerSettings-tab" data-bs-toggle="tab" href="#ODINO2registerSettings" role="tab" aria-controls="ODINO2registerSettings">Cage Settings</a>
            </li>
          </ul>
          <div class="tab-content mt-2" id="editAppTabsContent">
            <div class="tab-pane fade show active" id="ODINO2commonSettings" role="tabpanel" aria-labelledby="ODINO2-commonSettings-tab">
              ${regularFields.join("")}
            </div>
            <div class="tab-pane fade" id="ODINO2registerSettings" role="tabpanel" aria-labelledby="ODINO2-registerSettings-tab">
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <h5 class="mb-0">Cage Blocks</h5>
                  <button type="button" class="btn btn-sm btn-primary AddBlockInEditModal" onclick="addRegisterBlockRow('PYTRO_ODIN_O2_CAGES')"><i class="fa fa-plus-circle"></i> Add Block</button>
                </div>
                <table class="table table-bordered mt-2" id="registerBlockTable">
                  <thead>
                    <tr>
                      <th>CAGE ID</th>
                      <th>Flowmeter ID</th>
                      <th>O2 ID</th>
                      <th>VOUT</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody id="ODINO2registerBlockBody">
                    ${regDictNestedTables.join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else {
        // --- Other apps: flat layout ---
        formHtml += regularFields.length
          ? regularFields.join("")
          : `<p class="text-danger fw-bold">No editable fields available for this application.</p>`;
      }

      // --- Add Submit / Cancel buttons ---
      formHtml += `
        <div class="d-flex justify-content-between align-items-center mt-3">
          <div>
            <p id="offsetErrorContainer" style="margin-bottom: 0;display:none; color:red">Warning, the offset shouldn't be lesser than <span id="offsetValueError" class="mx-1 fw-bold">0</span></p>
          </div>
          <div class="d-flex gap-2">
            <button onclick="hideEditAppsModal()" class="btn btn-dark">Cancel</button>
            ${
              appKey === "PYTRO_MMR"
                ? `<button class="btn btn-success"
                          id="submitInEditModal"
                          onclick="saveMMRApp()">
                    Save changes
                  </button>`
                : `<button class="btn btn-success"
                          id="submitInEditModal"
                          onclick="saveAppChanges()">
                    Submit
                  </button>`
            }
          </div>
        </div>
      `;

      document.getElementById("editAppForm").innerHTML = formHtml;
      updateMMRBlockTitles();
    })
    .catch((err) => {
      console.error("Error loading data:", err);
      document.getElementById(
        "editAppContainer"
      ).innerHTML = `<p class="text-danger">Error loading Application.</p>`;
    });
}

// save MMR app
function saveMMRApp() {
  const appKey = "PYTRO_MMR";
  const mergedConfig = {};

  const mmrRegDict = {};
  const mmrEventDict = {};
  const mmrMetadata = {};
  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
    .then(res => res.json())
    .then(data => {
      const appIndex = data.apps.findIndex(app => app[appKey]);
      if (appIndex === -1) throw new Error("MMR app not found");

      const originalApp = data.apps[appIndex][appKey];

      /* ===============================
         SAVE NORMAL APP INPUTS
      =============================== */
      document
        .querySelectorAll("#editAppForm input, #editAppForm select, #editAppForm textarea")
        .forEach(input => {
          const key = input.name || input.id;
          if (!key) return;

          if (
            key.startsWith("name-") ||
            key.startsWith("description-") ||
            key.startsWith("decimal-") ||
            key.startsWith("offset-")
          ) return;

          // ❌ CRITICAL: skip flattened EVENTDICT keys
          if (/^PYTRO_MMR_EVENTDICT\.\d+(\.|$)/.test(key)) return;

          originalApp[key] = input.value;
        });

      /* ===============================
        BUILD REGDICT + METADATA
      =============================== */
      document.querySelectorAll(".mmr-block").forEach((blockEl, uiIndex) => {
        const blockKey = uiIndex + 1;

        const fnc = parseInt(
          blockEl.querySelector(`#fncSelect-${blockEl.dataset.blockKey}`).value,
          16
        );

        const start = Number(
          blockEl.querySelector(`#startOffset-${blockEl.dataset.blockKey}`).value
        );

        const numReg = Number(
          blockEl.querySelector(`#numReg-${blockEl.dataset.blockKey}`).value
        );

        const format = blockEl.querySelector(
          `#formatSelect-${blockEl.dataset.blockKey}`
        ).value;

        const isUInt =
          format === "Uint16" || format === "Uint32";

        const blockObj = {
          fnc,
          start,
          numReg,
          format
        };

        /* ✅ ONLY UINT FORMATS GET regDict */
        if (isUInt) {
          const regDict = {};

          blockEl.querySelectorAll(".register-row").forEach(row => {
            const offset = row.dataset.offset;
            const decimalInput = row.querySelector(`[id^="decimal-"]`);
            regDict[offset] = decimalInput
              ? Number(decimalInput.value) || 0
              : 0;
          });

          blockObj.regDict = regDict;
        }

        mmrRegDict[blockKey] = blockObj;

      /* ===============================
           METADATA (UI ONLY)
        =============================== */
        const metaBlock = {};

        blockEl.querySelectorAll(".register-row").forEach(row => {
          const offset = row.dataset.offset;

          const nameInput = row.querySelector(`[id^="name-"]`);
          const descInput = row.querySelector(`[id^="description-"]`);

          const name = nameInput?.value?.trim();
          const description = descInput?.value?.trim();

          if (name || description) {
            metaBlock[offset] = {};
            if (name) metaBlock[offset].name = name;
            if (description) metaBlock[offset].description = description;
          }
        });

        if (Object.keys(metaBlock).length) {
          mmrMetadata[blockKey] = metaBlock;
        }
      });

      /* ===============================
        BUILD PYTRO_MMR_EVENTDICT
      =============================== */
      const conditionCounter = {};
      const eventRows = document.querySelectorAll("#eventBlockBody tr");

      eventRows.forEach((row, rowIndex) => {
        const offset = row.querySelector(".event-index-input")?.value?.trim();
        if (!offset) {
          console.warn(`Skipping event row ${rowIndex + 1}: no offset`);
          return;
        }

        if (!conditionCounter[offset]) conditionCounter[offset] = 1;
        else conditionCounter[offset]++;

        const idx = conditionCounter[offset];

        if (!mmrEventDict[offset]) mmrEventDict[offset] = {};
        mmrEventDict[offset][idx] = {};

        const fields = row.querySelectorAll(".event-field");
        fields.forEach((field, i) => {
          const val = field.value;
          if (i === 0) mmrEventDict[offset][idx].EVENT = val;
          if (i === 1) mmrEventDict[offset][idx].PREV_VAL = val;
          if (i === 2) mmrEventDict[offset][idx].CURRENT_VAL = val;
          if (i === 3) mmrEventDict[offset][idx].UPDATE_REG = val;
          if (i === 4) mmrEventDict[offset][idx].UPDATE_VAL = val;
          if (i === 5) mmrEventDict[offset][idx].ACTION = val;
        });
      });

      /* ===============================
         SAVE SAME STRUCTURE (CLOUD + CONFIG)
      =============================== */
      data.apps[appIndex] = {
        [appKey]: {
          ...originalApp,
          PYTRO_MMR_REGDICT: mmrRegDict,
          PYTRO_MMR_EVENTDICT: mmrEventDict
        }
      };

      /* ===============================
         SAVE METADATA OUTSIDE APP
      =============================== */
      data.MMR_METADATA = mmrMetadata;

      mergedToConfig(mergedConfig, data);
      mergedConfig.PYTRO_MMR_REGDICT = mmrRegDict;
      mergedConfig.PYTRO_MMR_EVENTDICT = mmrEventDict;



      return fetch("/update-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac: renamed_mac_address,
          apps: data.apps,
          unitId: renamed_mac_address_unitId,
          board: renamed_board_name,
          MMR_METADATA: data.MMR_METADATA
        })
      });
    })
    .then(res => {
      if (!res.ok) throw new Error("Failed to save MMR");
      return res.json();
    })
    .then(() => {
      hideEditAppsModal();
      saveToConfigFile(
        mergedConfig,
        "MMR application saved successfully",
        "#208f5b"
      );
    })
    .catch(err => {
      console.error(err);
      showPopup("Error saving MMR application", "rgba(205,9,9,0.8)");
    });
}


// save app changes
function saveAppChanges() {
  const formContainer = document.getElementById("editAppForm");
  const inputs = formContainer.querySelectorAll("input, select, textarea");
  const appKey = document.getElementById("editAppKey")?.value;
  const updatedData = {};
  const mergedConfig = {};
  const DMMregDictData = {}; // To store block data for DMM REGDICT
  const RMM4regDictData = {}; // To store block data for RMM4 REGDICT
  const MRH4regDictData = {}; // To store block data for MRH4 REGDICT
  const eventDictData = {}; // To store block data for EVENTDICT
  const ODINO2regDictData = {};

  const inputsArray = Array.from(inputs);
  const invalidInput = inputsArray.find((input) => {
    return (
      !input.disabled && // Skip disabled fields
      input.offsetParent !== null && // Skip hidden fields
      input.value.trim() === "" // Empty or just whitespace
    );
  });
  if (invalidInput) {
    document.getElementById("popup").textContent =
      "Please fill in all required fields before saving.";
    showPopup("rgba(205, 9, 9, 0.8)");
    invalidInput.focus(); // Optional: highlight the first empty input
    return;
  }

  if (!appKey) {
    document.getElementById("popup").textContent = "Application is missing";
    showPopup("rgba(205, 9, 9, 0.8)");
    return;
  }

  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
    .then((res) => res.json())
    .then((data) => {
      const appIndex = data.apps.findIndex((app) => app.hasOwnProperty(appKey));
      if (appIndex === -1) {
        document.getElementById("popup").textContent = "Application not found";
        showPopup("rgba(205, 9, 9, 0.8)");
        return;
      }
      const originalApp = data.apps[appIndex][appKey];

      Object.keys(originalApp).forEach((key) => {
        if (
          /^PYTRO_DMM_REGDICT\.\d+\.(OFFSET|NUMREG|FORMAT)$/.test(key) ||
          /^PYTRO_RMM4_REGDICT\.\d+\.(OFFSET|NUMREG|FORMAT)$/.test(key) ||
          /^PYTRO_ODIN_O2_CAGES\.\d+\.(FLOWMETER_ID|O2_ID|VOUT)$/.test(key) ||
          /^PYTRO_MRH4_REGDICT\.\d+\.(OFFSET|NODE_ID)$/.test(key)
        ) {
          delete originalApp[key];
        }
      });

      inputs.forEach((input) => {
        const key = input.name;
        let value = input.value;

        if (!key || key.trim() === "") return;

        // ✅ Skip event fields from main loop
        if (/^PYTRO_DMM_EVENTDICT\.\d+(\.|$)/.test(key)) {
          return; // Skip both index-only keys and field keys
        }

        // Convert ON/OFF to uppercase consistently
        if (value.toUpperCase() === "ON" || value.toUpperCase() === "OFF") {
          value = value.toUpperCase();
        }

        // Handle block data, e.g., PYTRO_DMM_REGDICT.1.FORMAT
        const DMMregDictMatch = key.match(
          /^PYTRO_DMM_REGDICT\.(\d+)\.(OFFSET|NUMREG|FORMAT)$/
        );
        const RMM4regDictMatch = key.match(
          /^PYTRO_RMM4_REGDICT\.(\d+)\.(OFFSET|NUMREG|FORMAT)$/
        );
        const MRH4regDictMatch = key.match(
          /^PYTRO_MRH4_REGDICT\.(\d+)\.(OFFSET|NODE_ID)$/
        );
        const ODINO2regDictMatch = key.match(
          /^PYTRO_ODIN_O2_CAGES\.(\d+)\.(FLOWMETER_ID|O2_ID|VOUT)$/
        );
        if (DMMregDictMatch) {
          const blockNumber = DMMregDictMatch[1]; // "1", "2", etc.
          const field = DMMregDictMatch[2]; // "OFFSET", "NUMREG", "FORMAT"

          if (!DMMregDictData[blockNumber]) {
            DMMregDictData[blockNumber] = {}; // Create a new block if not already present
          }
          DMMregDictData[blockNumber][field] = value;
        } else if (RMM4regDictMatch) {
          const blockNumber = RMM4regDictMatch[1]; // "1", "2", etc.
          const field = RMM4regDictMatch[2]; // "OFFSET", "NUMREG", "FORMAT"

          if (!RMM4regDictData[blockNumber]) {
            RMM4regDictData[blockNumber] = {}; // Create a new block if not already present
          }
          RMM4regDictData[blockNumber][field] = value;
        } else if (MRH4regDictMatch) {
          const blockNumber = MRH4regDictMatch[1]; // "1", "2", etc.
          const field = MRH4regDictMatch[2]; // "OFFSET", "NUMREG", "FORMAT"

          if (!MRH4regDictData[blockNumber]) {
            MRH4regDictData[blockNumber] = {}; // Create a new block if not already present
          }
          MRH4regDictData[blockNumber][field] = value;
        } else if (ODINO2regDictMatch) {
          const blockNumber = ODINO2regDictMatch[1]; // "1", "2", etc.
          const field = ODINO2regDictMatch[2]; // "FLOWMETER_ID", "O2_ID", "VOUT"

          if (!ODINO2regDictData[blockNumber]) {
            ODINO2regDictData[blockNumber] = {}; // Create a new block if not already present
          }
          ODINO2regDictData[blockNumber][field] = value;
        } else {
          const originalValue = originalApp[key];
          if (Array.isArray(originalValue)) {
            const rest = originalValue.filter((v) => v !== value);
            updatedData[key] = [value, ...rest];
          } else {
            updatedData[key] = value;
          }
        }
      });

      // Temp map to track how many conditions per offset
      const conditionCounter = {};
      const eventRows = document.querySelectorAll("#eventBlockBody tr");

      eventRows.forEach((row, rowIndex) => {
        const offsetInput = row.querySelector(".event-index-input");
        const offset = offsetInput?.value.trim();

        if (!offset) {
          console.warn(`Skipping row ${rowIndex + 1}: missing offset`);
          return;
        }

        // Increment condition index for this offset
        if (!conditionCounter[offset]) {
          conditionCounter[offset] = 1;
        } else {
          conditionCounter[offset]++;
        }

        const conditionIndex = conditionCounter[offset]; // 1, 2, etc.

        if (!eventDictData[offset]) {
          eventDictData[offset] = {};
        }
        eventDictData[offset][conditionIndex] = {};

        const eventFields = row.querySelectorAll(".event-field");
        // Loop through all event fields and assign based on position
        eventFields.forEach((field, i) => {
          const val = field.value;
          if (i === 0) eventDictData[offset][conditionIndex]["EVENT"] = val;
          if (i === 1) eventDictData[offset][conditionIndex]["PREV_VAL"] = val;
          if (i === 2)
            eventDictData[offset][conditionIndex]["CURRENT_VAL"] = val;
          if (i === 3)
            eventDictData[offset][conditionIndex]["UPDATE_REG"] = val;
          if (i === 4)
            eventDictData[offset][conditionIndex]["UPDATE_VAL"] = val;
          if (i === 5) eventDictData[offset][conditionIndex]["ACTION"] = val;
        });
      });

      // If editing PYTRO_DMM, save blockData as a stringified JSON
      if (appKey === "PYTRO_DMM") {
        updatedData["PYTRO_DMM_REGDICT"] = DMMregDictData;
        updatedData["PYTRO_DMM_EVENTDICT"] = eventDictData;
      }
      if (appKey === "PYTRO_RMM4") {
        updatedData["PYTRO_RMM4_REGDICT"] = RMM4regDictData;
      }
      if (appKey === "PYTRO_MRH4") {
        updatedData["PYTRO_MRH4_REGDICT"] = MRH4regDictData;
      }
      if (appKey === "PYTRO_ODIN_O2") {
        updatedData["PYTRO_ODIN_O2_CAGES"] = ODINO2regDictData;
      }
      // Merge the updated fields into the original app data
      data.apps[appIndex] = {
        [appKey]: {
          ...data.apps[appIndex][appKey], // original values
          ...updatedData, // updated values from the form
        },
      };
      // Merge the blocks into updated data
      // Object.assign(updatedData, regDictData);
      mergedToConfig(mergedConfig, data);
      return fetch("/update-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mac: renamed_mac_address,
          apps: data.apps,
          unitId: renamed_mac_address_unitId,
          board: renamed_board_name,
        }),
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then(() => {
      hideEditAppsModal();
      saveToConfigFile(
        mergedConfig,
        "Application saved successfully",
        "#208f5b"
      );
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
  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
    .then((res) => res.json())
    .then((data) => {
      const appIndex = data.apps.findIndex((app) => app.hasOwnProperty(appKey));
      if (appIndex === -1) {
        document.getElementById("popup").textContent = "Application not found";
        showPopup("rgba(205, 9, 9, 0.8)");
        return;
      }
      // if (appKey === "PYTRO_DMM") {
      //   // ⚠️ Special case: disable RS4851 shared enable field
      //   const rs485App = data.apps.find((app) => app["PYTRO_MBRTU_RS4851"]);
      //   if (rs485App) {
      //     rs485App.PYTRO_MBRTU_RS4851.PYTRO_MBRTU_RS4851_ENABLE = "OFF";
      //     console.log(
      //       "Set PYTRO_MBRTU_RS4851_ENABLE to OFF (uninstalling PYTRO_DMM)"
      //     );
      //   }
      // } else {
      // Normal case: disable this app's enable field
      const originalApp = data.apps[appIndex][appKey];
      updatedData[enableKey] = "OFF";
      data.apps[appIndex] = {
        [appKey]: {
          ...originalApp, // original values
          ...updatedData, // updated from form
        },
      };
      // }
      mergedToConfig(mergedConfig, data);
      return fetch("/update-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mac: renamed_mac_address,
          apps: data.apps,
          unitId: renamed_mac_address_unitId,
          board: renamed_board_name,
        }),
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then(() => {
      saveToConfigFile(
        mergedConfig,
        "Application successfully uninstalled",
        "#208f5b"
      );
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
  fetch(`/get-data?macId=${renamed_mac_address_unitId}`)
    .then((res) => res.json())
    .then((data) => {
      const apps = data.apps;
      const appIndex = apps.findIndex((app) => app.hasOwnProperty(appKey));
      // Check if the app exists
      if (appIndex === -1) {
        document.getElementById(
          "popup"
        ).textContent = `The app ${appKey} not found.`;
        showPopup("rgba(205, 9, 9, 0.8)");
        return Promise.reject("App not found");
      }
      // Get the app object
      const targetApp = apps[appIndex][appKey];
      const targetHardware = targetApp[`${appKey}_HARDWARE`] || [];

      // ✅ Check hardware conflicts
      for (const appObj of apps) {
        const key = Object.keys(appObj)[0]; // app name
        if (key === appKey) continue; // skip target app

        const app = appObj[key];
        const isEnabled = app[`${key}_ENABLE`] === "ON";
        const otherHardware = app[`${key}_HARDWARE`] || [];
        if (isEnabled && targetHardware.length && otherHardware.length) {
          const conflict = targetHardware.some((hw) =>
            otherHardware.includes(hw)
          );
          if (conflict) {
            document.getElementById(
              "popup"
            ).textContent = `Cannot install ${appKey}. It shares hardware with ${key}.`;
            showPopup("rgba(205, 9, 9, 0.8)");
            return Promise.reject("Hardware conflict");
          }
        }
      }

      // ✅ No conflict → proceed with enabling
      targetApp[`${appKey}_ENABLE`] = "ON";
      console.log(`Set ${appKey}_ENABLE to ON`);
      // }
      mergedToConfig(mergedConfig, data);
      // Save the updated data back (assuming a POST request to save it)
      return fetch("/update-apps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mac: renamed_mac_address,
          apps: data.apps,
          unitId: renamed_mac_address_unitId,
          board: renamed_board_name,
        }),
      });
    })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to update apps.json");
      return res.json();
    })
    .then((resData) => {
      console.log("App updated successfully:", resData);
      saveToConfigFile(
        mergedConfig,
        "Application successfully installed",
        "#208f5b"
      );
    })
    .catch((err) => {
      console.error(err);
    });
}

async function downloadLogs() {
  let savedLogs = localStorage.getItem("logs");
  const textArea = document.getElementById("serial-output");
  const content = textArea.textContent;
  try {
    // if (savedLogs) {
    savedLogs += "\n" + content;
    localStorage.setItem("logs", savedLogs);
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
    // } else {
    //   document.getElementById("popup").textContent = "No Logs Saved Yet.";
    //   showPopup("rgba(205, 9, 9, 0.8)");
    // }
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
    await sleep(100);
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

/* =========================
   TERMINAL RESIZE LOGIC
   ========================= */

const row = document.getElementById("deviceInfoContainer");
const resizeHandle = document.getElementById("resizeHandle");
const card = document.getElementById("resizeCmd");
const terminalContainer = document.getElementById("terminalContainer");

let isResizing = false;

/*
  terminalMode:
  - "auto"      → edge-based (left:0 + right:0) → TRUE full width
  - "minimized" → 50% width
  - "manual"    → drag resize
*/
let terminalMode = "auto";
let manualRatio = 1;

/* ---------- HELPERS ---------- */

function getParentWidth() {
  return row.clientWidth || terminalContainer.clientWidth;
}

function getMinWidth() {
  return getParentWidth() / 2;
}

/* ---------- APPLY WIDTH ---------- */

function applyTerminalWidth() {
  const parentWidth = getParentWidth();
  if (!parentWidth) return;

  if (terminalMode === "auto") {
    // EDGE-BASED sizing (this is the key)
    card.style.width = "";
    card.style.left = "0";
    card.style.right = "0";
    return;
  }

  // WIDTH-BASED sizing
  card.style.left = "auto";
  card.style.right = "0";

  if (terminalMode === "minimized") {
    card.style.width = parentWidth * 0.5 + "px";
    return;
  }

  if (terminalMode === "manual") {
    card.style.width = parentWidth * manualRatio + "px";
  }
}

/* ---------- BUTTONS ---------- */

function widenTerminal() {
  terminalMode = "auto";
  manualRatio = 1;
  applyTerminalWidth();
}

function minimizeTerminal() {
  terminalMode = "minimized";
  applyTerminalWidth();
}

/* ---------- RESIZE HANDLE ---------- */

card.addEventListener("mousemove", (e) => {
  const rect = card.getBoundingClientRect();
  resizeHandle.style.display =
    e.clientX >= rect.left - 5 && e.clientX <= rect.left + 5
      ? "block"
      : "none";
});

/* ---------- DRAG RESIZE ---------- */

resizeHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  isResizing = true;
  terminalMode = "manual";
  document.body.style.cursor = "ew-resize";
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;

  const parentWidth = getParentWidth();
  if (!parentWidth) return;

  let newWidth =
    terminalContainer.getBoundingClientRect().right - e.clientX;

  const minWidth = getMinWidth();
  if (newWidth < minWidth) newWidth = minWidth;
  if (newWidth > parentWidth) newWidth = parentWidth;

  manualRatio = newWidth / parentWidth;

  // WIDTH-BASED sizing during drag
  card.style.left = "auto";
  card.style.right = "0";
  card.style.width = newWidth + "px";
});

document.addEventListener("mouseup", () => {
  if (!isResizing) return;
  isResizing = false;
  document.body.style.cursor = "default";
});

/* ---------- LAYOUT CHANGES ---------- */

// Screen resize
window.addEventListener("resize", applyTerminalWidth);

// Bootstrap tab switch
document.querySelectorAll('[data-bs-toggle="tab"]').forEach((tab) => {
  tab.addEventListener("shown.bs.tab", applyTerminalWidth);
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

document.querySelectorAll(".navList").forEach(function (element) {
  element.addEventListener("click", async function () {
    document.querySelectorAll(".navList").forEach(function (e) {
      e.classList.remove("active");
    });

    // Add active class to the clicked navList element
    this.classList.add("active");

    // Get the index of the clicked navList element
    var index = Array.from(this.parentNode.children).indexOf(this);

    // Hide all data-table elements
    document.querySelectorAll(".data-table").forEach(function (table) {
      table.style.display = "none";
    });

    // Show the corresponding table based on the clicked index
    var tables = document.querySelectorAll(".data-table");
    if (tables.length > index) {
      tables[index].style.display = 'block';
    }

    // Check if the clicked item is the second one (index 1)
    applicationTabIndex = index;
    if (applicationTabIndex === 2) {
      await StopScript();
      await SerialWrite(
        `\x03\r\nimport ubinascii,machine,network\r\na = ubinascii.hexlify(network.LAN().config('mac'), ':').decode().upper() if hasattr(network, "LAN") else machine.unique_id()[4:].hex().upper()\r\nprint(f"<>mac address : {a}<>")\r\nprint(f"<>board name : {machine.board_name()}<>")\r\n`
      );
    }
  });
});