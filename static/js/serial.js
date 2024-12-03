// Constants for DFU protocol
const DFU_UPLOAD = 0x02;
const DFU_DNLOAD = 0x01;
const DFU_GETSTATUS = 0x03;
const DFU_CLRSTATUS = 0x04;
const DFU_ABORT = 0x06;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// // This script will run once the page is fully loaded
// document.addEventListener("DOMContentLoaded", function () {
//   // Log that the DFU page is loaded
//   console.log("DFU page has loaded!");
//   SerialCom2();
// });

async function SerialCom() {
  try {
    const port = await navigator.serial.requestPort();

    // Open the serial port with the desired settings
    await port.open({ baudRate: 9600 });
    console.log("Serial port opened:", port.getInfo());

    const encoder = new TextEncoder();
    const writer = port.writable.getWriter();

    //Send Ctrl + C to stop any running code
    const ctrlC = encoder.encode("\x03"); // ASCII for Ctrl + C
    await writer.write(ctrlC);
    console.log("Sent Ctrl + C");

    //Send "import pyb" command
    const importPyb = encoder.encode("import pyb\r\n");
    await writer.write(importPyb);
    console.log("Sent 'import pyb'");

    //Send "pyb.bootloader()" command
    const enterBootloader = encoder.encode("pyb.bootloader()\r\n");
    await writer.write(enterBootloader);
    console.log("Sent 'pyb.bootloader()' to enter bootloader mode");

    // Close the writer after sending commands
    writer.releaseLock();

    // await sleep(3000);

    // const userConfirmed = confirm("Do you wish to continue ?");

    // Check if the user clicked "OK" (true) or "Cancel" (false)
    // if (userConfirmed) {
    //   // Run another function if user clicks "OK"
    //   connectWithUSB();
    // } else {
    //   console.log("User clicked Cancel.");
    // }
  } catch (err) {
    console.error("Failed to communicate with the serial port:", err);
  }
}

async function connectWithUSB() {
  try {
    // Trigger file selection dialog
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".dfu"; // Adjust file types as needed
    fileInput.onchange = async (event) => {
      const file = event.target.files[0];
      if (file) {
        // process the file as needed
        await DFU(file);
      }
    };
    fileInput.click();
  } catch (error) {
    console.log("ERROR DFU :", error);
  }
}

async function DFU(file) {
  const device = await navigator.usb.requestDevice({ filters: [] });
  if (device.productName === "STM32  BOOTLOADER") {
    await device.open();
    console.log("Device opened:", device);
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    console.log("Interface claimed");
    await Mass_Erase(device);
    await parseDfuFile(file, device);
    await Leave_DFU(device);
  } else {
    console.log("Selected device does not match the desired product name.");
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
async function Mass_Erase(device) {
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
      return;
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

    // Wait for the mass erase to complete (14 seconds)
    for (let i = 0; i < 14; i++) {
      console.log(`Erasing... (${i + 1}/14 seconds elapsed)`);
      await sleep(1000); // Wait for 1 second per iteration
    }

    // Ensure device is back in dfuIDLE state after erasing
    const eraseSuccess = await handleFaults(device);
    if (eraseSuccess) {
      console.log("Mass Erase Successful.");
    } else {
      console.error("Failed to stabilize the device after Mass Erase.");
    }
  } catch (error) {
    console.error("Error during Mass Erase:", error.message);
  }
}

// Function to Leave DFU
async function Leave_DFU(device) {
  try {
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
    }
    await getStatus(device);
  } catch (error) {
    console.error("Error Leaving DFU:", error.message);
  }
}

async function parseDfuFile(file, device) {
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
            break; // Exit the loop on error
          }

          // Get status again to verify the device state
          status = await getStatus(device);
          status = await getStatus(device);

          if (!status || status !== 0x05) {
            console.log("Error occurred, stopping firmware upload.");
            break;
          }

          // Increment the address for the next chunk
          dwElementAddress += 2048;
        } catch (error) {
          console.error("Error during firmware upload:", error.message);
          break;
        }
      }
    }
  }

  // Check for leftover bytes
  const remainingBytes = data.length - offset;
  if (remainingBytes > 0) {
    console.log(`${remainingBytes} bytes leftover.`);
  }

  console.log("Done parsing DfuSe file.");
}
