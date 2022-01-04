const WIDTH = 300;
const HEIGHT = 300;
let sentCount = 0;
let recvCount = 0;
let sentFramesCount = 0;
let recvFramesCount = 0;
const FRAMESIZE = WIDTH * HEIGHT * 4;
const HEADERSIZE = 16;
const connections = {};
let prevSequenceNumber = -1;
var queue = [];
var frameNumber = 0;
let frameCount = 0;
let dict = {};

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
    var transport = new WebTransport('https://web-platform.test:64224');
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
        startMedia(currentTransportDatagramWriter);
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
            frameNumber = sentFramesCount;
            sentFramesCount++;
            showStats();
            let offset = 0;

            let size = 1008;

            let chunk = imgData.data.slice(offset, offset + size);
    
            let writeBuffer = new Uint8ClampedArray(HEADERSIZE + chunk.length);
            const dv = new DataView(writeBuffer.buffer, 0); // is dataview too slow?

            // sends datagrams
            while (true) {
                if (offset + size > imgData.data.length) {
                    size = imgData.data.length - offset;
                }
                //console.log("SENDING", size);   // make sure this matches below
                await currentTransportDatagramWriter.ready;
                chunk = imgData.data.slice(offset, offset + size);

                // writeBuffer.length = (HEADERSIZE + chunk.length);
                // console.log(writeBuffer.length);

                writeBuffer.set(chunk, HEADERSIZE);
                
                dv.setUint32(0, streamId);
                dv.setUint32(4, sequenceNumber);  // can we get rid of these?
                dv.setUint32(8, offset + size >= imgData.data.length ? 1 : 0); // does the third parameter count as undefined? are we sending as big or little endian?
                dv.setUint32(12, frameNumber);

                // var data = encoder.encode(dv);

                await currentTransportDatagramWriter.write(dv); // find out if all data is being written
                sequenceNumber++;
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

        const dataSize = value.length - HEADERSIZE;
        let dv = new DataView(value.buffer);  
        const streamId = dv.getUint32(0);
        const sequenceNumber = dv.getUint32(4);
        const eof = dv.getUint32(8);
        const frameNumber = dv.getUint32(12);

        if (!connections[streamId]) {
          document.querySelector('#logs').innerHTML += `User ${streamId} connected\n`;    // if user's ID is not already present, show as connected
          connections[streamId] = createRemoteView(streamId);                                   // create video feed       
        }
        //const { context, buffer, bufferOffset } = connections[streamId];

        if (prevSequenceNumber != (sequenceNumber - 1) && sequenceNumber != 0) {
          console.log(prevSequenceNumber, sequenceNumber, dataSize)
          connections[streamId].bufferOffset = (connections[streamId].bufferOffset + dataSize*(sequenceNumber-prevSequenceNumber)-1008);
        }

        prevSequenceNumber = sequenceNumber;

        if (connections[streamId].bufferOffset + dataSize <= FRAMESIZE) {          // accounts for when data size is too big
          connections[streamId].buffer.set(value.slice(HEADERSIZE), connections[streamId].bufferOffset);
          connections[streamId].bufferOffset += dataSize;
        }

        if (eof == 1) {  // if end of video?
          render(connections[streamId]);
          connections[streamId].bufferOffset = 0;
        }

        console.log(sequenceNumber, connections[streamId].bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?

        recvCount ++;
        showStats();

        // let dv = new DataView(value.buffer);  
        // let frameNumber = dv.getUint32(12);

        // if (!dict[frameNumber]) {
        //   dict[frameNumber] = new Array()
        // }

        // console.log(dict);

        // dict[frameNumber].push(value);

        // var keys = Object.keys(dict)

        // for (var i = 0; i < keys.length; i++) {
        //   if (dict[keys[i]].length == 0) {
        //       delete dict[keys[i]];
        //   }
        // }

        // if (dict.length != 0) {
        //   keys = Object.keys(dict);
        //   keys.sort(function(a, b) {
        //       return a - b;
        //   });

        //   // var values = Object.keys(dict).map(function(key){
        //   //   return dict[key];
        //   // });

        //   var loops = dict[keys[0]].length

        //   for (var i = 0; i < loops; i++) {

        //     value = dict[keys[0]][i];
        //     dict[keys[0]].pop(value);

        //     const dataSize = value.length - HEADERSIZE;
        //     let dv = new DataView(value.buffer);  
        //     const streamId = dv.getUint32(0);
        //     const sequenceNumber = dv.getUint32(4);
        //     const eof = dv.getUint32(8);
        //     const frameNumber = dv.getUint32(12);

        //     if (!connections[streamId]) {
        //       document.querySelector('#logs').innerHTML += `User ${streamId} connected\n`;    // if user's ID is not already present, show as connected
        //       connections[streamId] = createRemoteView(streamId);                                   // create video feed       
        //     }
        //     //const { context, buffer, bufferOffset } = connections[streamId];

        //     if (prevSequenceNumber != (sequenceNumber - 1) && sequenceNumber != 0) {
        //       //console.log(prevSequenceNumber, sequenceNumber, dataSize)
        //       connections[streamId].bufferOffset = (connections[streamId].bufferOffset + dataSize*(sequenceNumber-prevSequenceNumber)-1008);
        //     }

        //     //console.log(connections[streamId].bufferOffset);

        //     prevSequenceNumber = sequenceNumber;

        //     if (connections[streamId].bufferOffset + dataSize <= FRAMESIZE) {          // accounts for when data size is too big
        //       connections[streamId].buffer.set(value.slice(HEADERSIZE), connections[streamId].bufferOffset);
        //       connections[streamId].bufferOffset += dataSize;
        //     }

        //     else if (connections[streamId].bufferOffset + dataSize >= FRAMESIZE || eof == 1) {  // if end of video?
        //       render(connections[streamId]);
        //       connections[streamId].bufferOffset = 0;
        //     }

        //     //console.log(sequenceNumber, connections[streamId].bufferOffset, dataSize, eof);     // eof and bufferOffset do not line up?

        //     recvCount ++;
        //     showStats();

            //addToEventLog('Datagram received');
          //}
        //}
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
    console.log("creating remote view");
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
    // console.log("-----------------");
    // console.log("RENDER FRAME");
    view.context.putImageData(new ImageData(view.buffer, WIDTH, HEIGHT), 0, 0);
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

async function startMedia(datagramWriter) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {width: {exact: WIDTH}, height: {exact: HEIGHT}}, audio: false });
    const video = document.querySelector('#local'); // how does this work? is this the video id defined at the start? yes probably
    video.srcObject = stream;
    video.muted = true;
    video.play();   // unsure what this does

    let streamId = Math.floor(Math.random() * 4294967295);  // should use uuid instead
    let sequenceNumber = 0;
    let ts = Date.now();

    const canvasContext = document.createElement("canvas").getContext("2d");
    setInterval(async () => {
        sendData(canvasContext, video, streamId, sequenceNumber, ts);
    }, 5000);
};