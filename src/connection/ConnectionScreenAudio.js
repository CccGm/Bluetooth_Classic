import React from 'react';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import {
  Container,
  Text,
  Header,
  Left,
  Button,
  Icon,
  Body,
  Title,
  Subtitle,
  Right,
} from 'native-base';

import {
  FlatList,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import {Buffer} from 'buffer';
import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';
import Permissions from 'react-native-permissions';
import AudioRecord from 'react-native-audio-record';

/**
 * Manages a selected device connection.  The selected Device should
 * be provided as {@code props.device}, the device will be connected
 * to and processed as such.
 *
 * @author kendavidson
 */
export default class ConnectionScreenAudio extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      text: undefined,
      data: [],
      polling: false,
      connection: false,
      connectionOptions: {
        DELIMITER: '9',
      },
    };
  }

  /**
   * Removes the current subscriptions and disconnects the specified
   * device.  It could be possible to maintain the connection across
   * the application, but for now the connection is within the context
   * of this screen.
   */
  async componentWillUnmount() {
    if (this.state.connection) {
      try {
        await this.props.device.disconnect();
      } catch (error) {
        // Unable to disconnect from device
      }
    }

    this.uninitializeRead();
  }

  /**
   * Attempts to connect to the provided device.  Once a connection is
   * made the screen will either start listening or polling for
   * data based on the configuration.
   */
  componentDidMount() {
    setTimeout(() => this.connect(), 0);
  }

  async connect() {
    try {
      let connection = await this.props.device.isConnected();
      if (!connection) {
        this.addData({
          data: `Attempting connection to ${this.props.device.address}`,
          timestamp: new Date(),
          type: 'error',
        });

        console.log(this.state.connectionOptions);
        connection = await this.props.device.connect();

        this.addData({
          data: 'Connection successful',
          timestamp: new Date(),
          type: 'info',
        });
      } else {
        this.addData({
          data: `Connected to ${this.props.device.address}`,
          timestamp: new Date(),
          type: 'error',
        });
      }

      this.setState({connection});
      this.initializeRead();
    } catch (error) {
      this.addData({
        data: `Connection failed: ${error.message}`,
        timestamp: new Date(),
        type: 'error',
      });
    }
  }

  async disconnect(disconnected) {
    try {
      if (!disconnected) {
        disconnected = await this.props.device.disconnect();
      }

      this.addData({
        data: 'Disconnected',
        timestamp: new Date(),
        type: 'info',
      });

      this.setState({connection: !disconnected});
    } catch (error) {
      this.addData({
        data: `Disconnect failed: ${error.message}`,
        timestamp: new Date(),
        type: 'error',
      });
    }

    // Clear the reads, so that they don't get duplicated
    this.uninitializeRead();
  }

  initializeRead() {
    this.disconnectSubscription = RNBluetoothClassic.onDeviceDisconnected(() =>
      this.disconnect(true),
    );

    if (this.state.polling) {
      this.readInterval = setInterval(() => this.performRead(), 5000);
    } else {
      this.readSubscription = this.props.device.onDataReceived(data =>
        this.onReceivedData(data),
      );
    }
  }

  /**
   * Clear the reading functionality.
   */
  uninitializeRead() {
    if (this.readInterval) {
      clearInterval(this.readInterval);
    }
    if (this.readSubscription) {
      this.readSubscription.remove();
    }
  }

  async performRead() {
    try {
      console.log('Polling for available messages');
      let available = await this.props.device.available();
      console.log(`There is data available [${available}], attempting read`);

      if (available > 0) {
        for (let i = 0; i < available; i++) {
          console.log(`reading ${i}th time`);
          let data = await this.props.device.read();

          console.log(`Read data ${data}`);
          console.log(data);
          this.onReceivedData({data});
        }
      }
    } catch (err) {
      console.log(err);
    }
  }

  /**
   * Handles the ReadEvent by adding a timestamp and applying it to
   * list of received data.
   *
   * @param {ReadEvent} event
   */
  async onReceivedData(event) {
    console.log('recive => ', event.toString());
    event.timestamp = new Date();
    this.addData({
      ...event,
      timestamp: new Date(),
      type: 'receive',
    });
  }

  async addData(message) {
    this.setState({data: [message, ...this.state.data]});
  }

  /**
   * Attempts to send data to the connected Device.  The input text is
   * padded with a NEWLINE (which is required for most commands)
   */
  async sendData(MSG) {
    try {
      console.log(`Attempting to send data ${MSG}`);
      let message = this.state.text + '\n';
      await RNBluetoothClassic.writeToDevice(
        this.props.device.address,
        message,
      );

      this.addData({
        timestamp: new Date(),
        data: this.state.text,
        type: 'sent',
      });

      let data = Buffer.alloc(10, 0xef);
      await this.props.device.write(data);

      this.addData({
        timestamp: new Date(),
        data: `Byte array: ${data.toString()}`,
        type: 'sent',
      });

      this.setState({text: undefined});
    } catch (error) {
      console.log(error);
    }
  }

  async toggleConnection() {
    if (this.state.connection) {
      this.disconnect();
    } else {
      this.connect();
    }
  }

  //// -------
  sound = null;
  state = {
    audioFile: '',
    recording: false,
    loaded: false,
    paused: true,
    base64: '',
  };

  async componentDidMount() {
    await this.checkPermission();

    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      wavFile: 'test.wav',
    };

    AudioRecord.init(options);

    AudioRecord.on();
  }

  checkPermission = async () => {
    const p = await Permissions.check('microphone');
    console.log('permission check', p);
    if (p === 'authorized') return;
    return this.requestPermission();
  };

  requestPermission = async () => {
    const p = await Permissions.request('microphone');
    console.log('permission request', p);
  };

  start = () => {
    console.log('start record');
    this.setState({audioFile: '', recording: true, loaded: false});
    AudioRecord.start();
  };

  stop = async () => {
    if (!this.state.recording) return;
    console.log('stop record');
    let audioFile = await AudioRecord.stop();
    console.log('audioFile', audioFile);
    this.setState({audioFile, recording: false});
  };

  load = () => {
    let filePath = '/data/user/0/com.audio_record/files/test1.wav';
    return new Promise((resolve, reject) => {
      if (!this.state.audioFile) {
        return reject('file path is empty');
      }

      this.sound = new Sound(filePath, '', error => {
        if (error) {
          console.log('failed to load the file', error);
          return reject(error);
        }
        this.setState({loaded: true});
        return resolve();
      });
    });
  };

  play = async () => {
    if (!this.state.loaded) {
      try {
        await this.load();
      } catch (error) {
        console.log(error);
      }
    }

    this.setState({paused: false});
    Sound.setCategory('Playback');

    this.sound.play(success => {
      if (success) {
        console.log('successfully finished playing');
      } else {
        console.log('playback failed due to audio decoding errors');
      }
      this.setState({paused: true});
      // this.sound.release();
    });
  };

  pause = () => {
    this.sound.pause();
    this.setState({paused: true});
  };

  convert = () => {
    let filePath = '/data/user/0/com.audio_record/files/test.wav';
    RNFS.readFile(filePath, 'base64')
      .then(res => {
        console.log(res, '=< convertd');
        console.log('Converted to base64');
        this.sendData(res);
      })
      .catch(err => {
        console.log(err.message, err.code, '<= error');
      });
  };

  revrse = () => {
    let filePath = '/data/user/0/com.audio_record/files/test1.wav';
    // console.log(this.state.base64, '<= data');
    RNFS.writeFile(filePath, this.state.base64, 'base64')
      .then(res => {
        console.log('revrse to wav');
        // this.setState({base64: res});
      })
      .catch(err => {
        console.log(err.message, err.code, '<= error to reverse');
      });
  };

  render() {
    let toggleIcon = this.state.connection
      ? 'radio-button-on'
      : 'radio-button-off';
    const {recording, paused, audioFile} = this.state;
    return (
      <Container>
        <Header iosBarStyle="light-content">
          <Left>
            <Button transparent onPress={this.props.onBack}>
              <Icon type="Ionicons" name="arrow-back" />
            </Button>
          </Left>
          <Body>
            <Title>{this.props.device.name}</Title>
            <Subtitle>{this.props.device.address}</Subtitle>
          </Body>
          <Right>
            <Button transparent onPress={() => this.toggleConnection()}>
              <Icon type="Ionicons" name={toggleIcon} />
            </Button>
          </Right>
        </Header>
        <View style={styles.connectionScreenWrapper}>
          <FlatList
            style={styles.connectionScreenOutput}
            contentContainerStyle={{justifyContent: 'flex-end'}}
            inverted
            ref="scannedDataList"
            data={this.state.data}
            keyExtractor={item => item.timestamp.toISOString()}
            renderItem={({item}) => (
              <View
                id={item.timestamp.toISOString()}
                flexDirection={'row'}
                justifyContent={'flex-start'}>
                <Text>{item.timestamp.toLocaleDateString()}</Text>
                <Text>{item.type === 'sent' ? ' < ' : ' > '}</Text>
                <Text flexShrink={1}>{item.data.trim()}</Text>
              </View>
            )}
          />
          <InputArea
            text={this.state.text}
            onChangeText={text => this.setState({text})}
            onSend={() => this.sendData()}
            disabled={!this.state.connection}
          />
          <View>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.container}
                onPress={this.start}
                disabled={recording}>
                <Text>Record</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.container}
                onPress={this.stop}
                disabled={!recording}>
                <Text>Stop</Text>
              </TouchableOpacity>
              {paused ? (
                <TouchableOpacity
                  style={styles.container}
                  onPress={this.play}
                  disabled={!audioFile}>
                  <Text>Play</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.container}
                  onPress={this.pause}
                  disabled={!audioFile}>
                  <Text>Pause</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.container} onPress={this.convert}>
                <Text>Send Data</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.container} onPress={this.revrse}>
                <Text>Revrse</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Container>
    );
  }
}

const InputArea = ({text, onChangeText, onSend, disabled}) => {
  let style = disabled ? styles.inputArea : styles.inputAreaConnected;
  return (
    <View style={style}>
      <TextInput
        style={styles.inputAreaTextInput}
        placeholder={'Command/Text'}
        value={text}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSend}
        returnKeyType="send"
        disabled={disabled}
      />
      <TouchableOpacity
        style={styles.inputAreaSendButton}
        onPress={onSend}
        disabled={disabled}>
        <Text>Send</Text>
      </TouchableOpacity>
    </View>
  );
};

/**
 * TextInput and Button for sending
 */
const styles = StyleSheet.create({
  connectionScreenWrapper: {
    flex: 1,
  },
  connectionScreenOutput: {
    flex: 1,
    paddingHorizontal: 8,
  },
  inputArea: {
    flexDirection: 'row',
    alignContent: 'stretch',
    backgroundColor: '#ccc',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  inputAreaConnected: {
    flexDirection: 'row',
    alignContent: 'stretch',
    backgroundColor: '#90EE90',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  inputAreaTextInput: {
    flex: 1,
    height: 40,
  },
  inputAreaSendButton: {
    justifyContent: 'center',
    flexShrink: 1,
  },
  container: {
    borderWidth: 1,
    borderRadius: 5,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
});
