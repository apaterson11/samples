console.log = function () { };

const WIDTH = 150;
const HEIGHT = 150;
let sentCount = 0;
let recvCount = 0;
let sentFramesCount = 0;
let recvFramesCount = 0;
const FRAMESIZE = WIDTH * HEIGHT * 4;
const HEADERSIZE = 16;
const connections = {};
var queue = [];
var frameNumber = 0;
let prevFrameNumber = 0;
let forgottenFrames = [];
let dict = {};
let prevSequenceNumber = -1;
let counter = 0;
let keys = null;
let prevValue = null;

const videoGrid = document.getElementById('video-grid');

{/* shows stats, unnecessary but could be useful for metric analysis */}
const showStats = () => {
    document.querySelector('#stats').innerHTML = `QUIC Datagrams sent:${sentCount}\nQUIC Datagrams recv:${recvCount}\nFrames sent:${sentFramesCount}\nFrames recv:${recvFramesCount}\n`;
    // if (recvCount == 10000) {
    //     t2 = performance.now();
    //     console.log(`Receiving 1000 datagrams took ${t2 - t1} milliseconds.`);
    // }
};

let currentTransport, streamNumber, currentTransportDatagramWriter;

// "Connect" button handler.
//   const url = document.getElementById('url').value;
try {
    var transport = new WebTransport('https://web-platform.test:50828');
    addToEventLog('Initiating connection...');
} catch (e) {
    addToEventLog('Failed to create connection object. ' + e, 'error');
}

try {
    await transport.ready;
    addToEventLog('Connection ready.');
    currentTransport = transport;
    streamNumber = 1;
    try {
        currentTransportDatagramWriter = transport.datagrams.writable.getWriter();
        addToEventLog('Datagram writer ready.');
        startMedia();
    } catch (e) {
        addToEventLog('Sending datagrams not supported: ' + e, 'error');
    }
    readDatagrams(transport);
    acceptUnidirectionalStreams(transport);
} catch (e) {
    addToEventLog('Connection failed. ' + e, 'error');
}

transport.closed
    .then(() => {
    addToEventLog('Connection closed normally.');
    })
    .catch(() => {
    addToEventLog('Connection closed abruptly.', 'error');
    });


// document.forms.sending.elements.send.disabled = false;
// document.getElementById('connect').disabled = true;

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

// "Send data" button handler.
async function sendData(canvasContext, video, streamId, sequenceNumber, ts) {
    let encoder = new TextEncoder('utf-8');
    // let rawData = sending.data.value;
    // let data = encoder.encode(rawData);
    let transport = currentTransport;
    let type = 'datagram';
    try {
      switch (type) {
        case 'datagram':
            canvasContext.drawImage(video, 0, 0, WIDTH, HEIGHT);
            const imgData = canvasContext.getImageData(0, 0, WIDTH, HEIGHT);

            ts = Date.now();
            sentFramesCount++;
            const frameNumber = sentFramesCount;
            // prevSequenceNumber = -1;
            showStats();
            let offset = 0;

            // sends datagrams
            while (true) {
                let size = 1008;
                if (offset + size > imgData.data.length) {
                    size = imgData.data.length - offset;
                }
                //console.log("SENDING", size);   // make sure this matches below
                await currentTransportDatagramWriter.ready;
                const chunk = imgData.data.slice(offset, offset + size);

                let writeBuffer = new Uint8ClampedArray(HEADERSIZE + chunk.length);
                const dv = new DataView(writeBuffer.buffer, 0); // is dataview too slow?

                // writeBuffer.length = (HEADERSIZE + chunk.length);
                // console.log(writeBuffer.length);

                sequenceNumber++;

                writeBuffer.set(chunk, HEADERSIZE);
                
                dv.setUint32(0, streamId);
                dv.setUint32(4, sequenceNumber);  // can we get rid of these?
                dv.setUint32(8, offset + size >= imgData.data.length ? 1 : 0); // does the third parameter count as undefined? are we sending as big or little endian?
                dv.setUint32(12, frameNumber);

                // var data = encoder.encode(dv);

                await currentTransportDatagramWriter.write(dv); // find out if all data is being written
                sentCount++;
                showStats();
                offset += size;
                
                if (offset >= imgData.data.length) { 
                    break;
                }
            }
            //addToEventLog('Sent frame');
            break;
        case 'unidi': {
          let stream = await transport.createUnidirectionalStream();
          let writer = stream.getWriter();
          await writer.write(data);
          await writer.close();
          addToEventLog('Sent a unidirectional stream with data: ' + rawData);
          break;
        }
        case 'bidi': {
          let stream = await transport.createBidirectionalStream();
          let number = streamNumber++;
          readFromIncomingStream(stream, number);
  
          let writer = stream.writable.getWriter();
          await writer.write(data);
          await writer.close();
          addToEventLog(
              'Opened bidirectional stream #' + number +
              ' with data: ' + rawData);
          break;
        }
      }
    } catch (e) {
      addToEventLog('Error while sending data: ' + e, 'error');
    }
}

// Reads datagrams from |transport| into the event log until EOF is reached.
async function readDatagrams(transport) {
    try {
      var reader = transport.datagrams.readable.getReader();
      addToEventLog('Datagram reader ready.');
    } catch (e) {
      addToEventLog('Receiving datagrams not supported: ' + e, 'error');
      return;
    }
    let decoder = new TextDecoder('utf-8');
    try {
      
      while (true) {
        var { value, done } = await reader.read();
        if (done) {
          addToEventLog('Done reading datagrams!');
          return;
        }

        const dv = new DataView(value.buffer);  
        const streamId = dv.getUint32(0);
        const sequenceNumber = dv.getUint32(4);
        const eof = dv.getUint32(8);
        const frameNumber = dv.getUint32(12);

        if (!dict[frameNumber]) {
          dict[frameNumber] = []
        }

        if (!(value in dict) && !(frameNumber in forgottenFrames)) {
          dict[frameNumber].push(value);
        }

        keys = Object.keys(dict);
        keys.sort(function(a, b) {
            return a - b;
        });

        let idx = 0;
        value = dict[keys[idx]].shift();
        if (!value) {
          counter++;
          if (counter == 100) {
            forgottenFrames.push(prevFrameNumber)
            console.log("backup render");
            render(connections[streamId]);
            delete dict[keys[idx]];
            counter = 0;
            prevSequenceNumber = 1;
          }
          continue;
        }

        const dv2 = new DataView(value.buffer);  
        const streamId2 = dv2.getUint32(0);
        const sequenceNumber2 = dv2.getUint32(4);
        const eof2 = dv2.getUint32(8);
        const frameNumber2 = dv2.getUint32(12);

        prevFrameNumber = frameNumber2;

        const dataSize = value.length - HEADERSIZE;

        if (!connections[streamId2]) {
          document.querySelector('#logs').innerHTML += `User ${streamId2} connected\n`;    // if user's ID is not already present, show as connected
          connections[streamId2] = createRemoteView(streamId2);                                   // create video feed       
        }

        // ****** code that was meant to deal with missed datagrams 
        if (prevSequenceNumber != (sequenceNumber2 - 1) && sequenceNumber2 != 1) {
          console.log(frameNumber2, prevSequenceNumber, sequenceNumber2, dataSize)
          connections[streamId2].bufferOffset = (connections[streamId2].bufferOffset + dataSize*(sequenceNumber2-prevSequenceNumber)-1008);
        }

        prevSequenceNumber = sequenceNumber2;

        if (connections[streamId2].bufferOffset + dataSize <= FRAMESIZE) {          // accounts for when data size is too big
          connections[streamId2].buffer.set(value.slice(HEADERSIZE), connections[streamId2].bufferOffset);
          connections[streamId2].bufferOffset += dataSize;
        }

        console.log(frameNumber2, sequenceNumber2, connections[streamId2].bufferOffset, dataSize, eof2);     // eof and bufferOffset do not line up?

        if (eof2 == 1) {
          (console.log("main render"))
          render(connections[streamId2]);
          delete dict[keys[idx]];
          prevSequenceNumber = 1;
        }

        recvCount ++;
        showStats();
      }
    } catch (e) {
      addToEventLog('Error while reading datagrams: ' + e, 'error');
    }
}

async function acceptUnidirectionalStreams(transport) {
    let reader = transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          addToEventLog('Done accepting unidirectional streams!');
          return;
        }
        let stream = value;
        let number = streamNumber++;
        addToEventLog('New incoming unidirectional stream #' + number);
        readFromIncomingStream(stream, number);
      }
    } catch (e) {
      addToEventLog('Error while accepting streams: ' + e, 'error');
    }
}
  
async function readFromIncomingStream(stream, number) {
    let decoder = new TextDecoderStream('utf-8');
    let reader = stream.pipeThrough(decoder).getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          addToEventLog('Stream #' + number + ' closed');
          return;
        }
        let data = value;
        addToEventLog('Received data on stream #' + number + ': ' + data);
      }
    } catch (e) {
      addToEventLog(
          'Error while reading from stream #' + number + ': ' + e, 'error');
      addToEventLog('    ' + e.message);
    }
}

const createRemoteView = (id) => {
    //console.log("creating remote view");
    const canvas = document.createElement('canvas');
    canvas.setAttribute("id", `remote_${id}`);
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    const buffer = new Uint8ClampedArray(FRAMESIZE);
    const bufferOffset = 0;
    videoGrid.appendChild(canvas);  
    return { canvas, context, buffer, bufferOffset };
};

{/* renders received media data */}
async function render(view){
    recvFramesCount++;
    console.log("----------------- RENDER FRAME -----------------");
    view.context.putImageData(new ImageData(view.buffer, WIDTH, HEIGHT), 0, 0);
    view.bufferOffset = 0;
};
  
function addToEventLog(text, severity = 'info') {
    let log = document.getElementById('event-log');
    let mostRecentEntry = log.lastElementChild;
    let entry = document.createElement('li');
    entry.innerText = text;
    entry.className = 'log-' + severity;
    log.appendChild(entry);
  
    // If the most recent entry in the log was visible, scroll the log to the
    // newly added element.
    if (mostRecentEntry != null &&
        mostRecentEntry.getBoundingClientRect().top <
            log.getBoundingClientRect().bottom) {
      entry.scrollIntoView();
    }
}

async function startMedia() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {width: {exact: WIDTH}, height: {exact: HEIGHT}}, audio: false });
    const video = document.querySelector('#local'); // how does this work? is this the video id defined at the start? yes probably
    video.srcObject = stream;
    video.muted = true;
    video.play();   // unsure what this does

    let streamId = Math.floor(Math.random() * 4294967295);  // should use uuid instead
    var sequenceNumber = 0;
    let ts = Date.now();

    const canvasContext = document.createElement("canvas").getContext("2d");
    setInterval(async () => {
        sendData(canvasContext, video, streamId, sequenceNumber, ts);
    }, 100);
};