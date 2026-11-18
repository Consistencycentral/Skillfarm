import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { askSkillFarm } from '../lib/ai';
import { theme } from '../constants/theme';

const STARTERS = [
  'Which SkillFarm course should I choose?',
  'Explain this course in simple terms',
  'What should I prepare before training?',
  'What are the key things I should learn first?',
];

export default function AIAssistantScreen() {
  const params = useLocalSearchParams<{ courseId?: string; courseTitle?: string }>();
  const courseId = typeof params.courseId === 'string' ? params.courseId : undefined;
  const courseTitle = typeof params.courseTitle === 'string' ? params.courseTitle : undefined;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const starters = useMemo(() => courseId
    ? ['What will I learn in this course?', 'Is this course suitable for a beginner?', 'What should I prepare before training?', 'Explain the course in simple terms']
    : STARTERS, [courseId]);

  async function submit(text = question) {
    const value = text.trim();
    if (!value || loading) return;
    setQuestion(value); setError(''); setLoading(true);
    try { setAnswer(await askSkillFarm(value, courseId)); }
    catch (e: any) { setError(e?.message ?? 'AI could not answer right now.'); }
    finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="arrow-back" size={21} color={theme.colors.text} /></Pressable>
        <View style={styles.headerIcon}><Ionicons name="sparkles" size={19} color={theme.colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ask SkillFarm</Text>
          <Text style={styles.sub}>{courseTitle ? `About ${courseTitle}` : 'Your practical learning assistant'}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introTitle}>What can I help with?</Text>
          <Text style={styles.introText}>Get practical explanations for SkillFarm courses, agriculture learning and training preparation.</Text>
        </View>
        <View style={styles.chips}>
          {starters.map((s) => <Pressable key={s} onPress={() => submit(s)} style={styles.chip}><Text style={styles.chipText}>{s}</Text></Pressable>)}
        </View>
        {loading ? <View style={styles.loading}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.loadingText}>Thinking…</Text></View> : null}
        {error ? <View style={styles.error}><Ionicons name="alert-circle-outline" size={19} color={theme.colors.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}
        {answer ? <View style={styles.answer}><View style={styles.answerHead}><Ionicons name="sparkles" size={17} color={theme.colors.primary} /><Text style={styles.answerLabel}>SkillFarm AI</Text></View><Text style={styles.answerText}>{answer}</Text></View> : null}
        <Text style={styles.disclaimer}>AI can make mistakes. For safety, medical, pesticide, legal or financial decisions, verify with a qualified local expert or official source.</Text>
      </ScrollView>
      <View style={styles.composer}>
        <TextInput value={question} onChangeText={setQuestion} placeholder="Ask a SkillFarm question…" placeholderTextColor={theme.colors.textMuted} style={styles.input} multiline maxLength={1200} onSubmitEditing={() => submit()} />
        <Pressable onPress={() => submit()} disabled={!question.trim() || loading} style={[styles.send, (!question.trim() || loading) && styles.sendDisabled]} accessibilityRole="button" accessibilityLabel="Arrow up"><Ionicons name="arrow-up" size={20} color="#fff" /></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:theme.colors.background}, header:{flexDirection:'row',alignItems:'center',gap:10,padding:14,borderBottomWidth:1,borderBottomColor:theme.colors.border,backgroundColor:'#fff'}, back:{width:38,height:38,alignItems:'center',justifyContent:'center'}, headerIcon:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'#EAF5EB'}, title:{fontSize:17,fontWeight:'900',color:theme.colors.text}, sub:{fontSize:11,color:theme.colors.textMuted,marginTop:2}, content:{padding:16,paddingBottom:28}, intro:{padding:17,borderRadius:18,backgroundColor:'#fff',borderWidth:1,borderColor:theme.colors.border},introTitle:{fontSize:19,fontWeight:'900',color:theme.colors.text},introText:{fontSize:13,lineHeight:19,color:theme.colors.textMuted,marginTop:6},chips:{gap:9,marginTop:14},chip:{alignSelf:'flex-start',paddingHorizontal:13,paddingVertical:10,borderRadius:15,backgroundColor:'#fff',borderWidth:1,borderColor:theme.colors.border},chipText:{fontSize:12,fontWeight:'700',color:theme.colors.text},loading:{flexDirection:'row',alignItems:'center',gap:8,marginTop:15},loadingText:{fontSize:12,color:theme.colors.textMuted},error:{marginTop:14,padding:12,borderRadius:12,backgroundColor:'#fff0f0',flexDirection:'row',gap:8},errorText:{flex:1,fontSize:12,color:theme.colors.danger,lineHeight:17},answer:{marginTop:16,padding:17,borderRadius:18,backgroundColor:'#fff',borderWidth:1,borderColor:theme.colors.border},answerHead:{flexDirection:'row',alignItems:'center',gap:7},answerLabel:{fontSize:12,fontWeight:'900',color:theme.colors.primary},answerText:{fontSize:14,lineHeight:21,color:theme.colors.text,marginTop:9},disclaimer:{fontSize:10,lineHeight:15,color:theme.colors.textMuted,marginTop:15},composer:{padding:10,borderTopWidth:1,borderTopColor:theme.colors.border,backgroundColor:'#fff',flexDirection:'row',alignItems:'flex-end',gap:8},input:{flex:1,minHeight:44,maxHeight:100,borderWidth:1,borderColor:theme.colors.border,borderRadius:15,paddingHorizontal:13,paddingVertical:10,fontSize:13,color:theme.colors.text,backgroundColor:theme.colors.background},send:{width:44,height:44,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.primary},sendDisabled:{opacity:.45}
});
