import { View, StyleSheet } from 'react-native';
import { theme } from '../constants/theme';
import { Pulse } from './motion';
export function CourseSkeleton() {
  return <Pulse><View style={styles.card}><View style={styles.short}/><View style={styles.title}/><View style={styles.line}/><View style={styles.line}/><View style={styles.bottom}/></View></Pulse>;
}
const styles = StyleSheet.create({ card:{backgroundColor:theme.colors.surface,borderRadius:theme.radius.xl,padding:18,marginBottom:14,borderWidth:1,borderColor:theme.colors.border},short:{width:90,height:18,borderRadius:8,backgroundColor:theme.colors.surfaceAlt,marginBottom:14},title:{width:'78%',height:22,borderRadius:6,backgroundColor:theme.colors.surfaceAlt,marginBottom:12},line:{width:'92%',height:12,borderRadius:6,backgroundColor:theme.colors.surfaceAlt,marginBottom:8},bottom:{width:'100%',height:42,borderRadius:10,backgroundColor:theme.colors.surfaceAlt,marginTop:8}});
