import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function CrateScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Crate</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  text: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '600',
  },
});
