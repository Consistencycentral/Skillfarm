import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Alert, ActivityIndicator,
  ScrollView, Modal, Platform, Image,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { listCourseMaterials, createMaterial, deleteMaterial, updateMaterial, type MaterialType } from '../../../api/materials';
import { pickMaterialFile, pickPdfFile, paperPhotoToPdf, uploadMaterialFile, deleteMaterialFile } from '../../../lib/materialStorage';
import { supabase } from '../../../lib/supabase';
import { theme } from '../../../constants/theme';

export default function ProviderMaterials(){
 const {courseId}=useLocalSearchParams<{courseId:string}>();
 const[m,setM]=useState<any[]>([]); const[loading,setLoading]=useState(true); const[busy,setBusy]=useState(false);
 const[title,setTitle]=useState(''); const[titleTa,setTitleTa]=useState(''); const[type,setType]=useState<MaterialType>('pdf'); const[poll,setPoll]=useState('');
 const[cameraOpen,setCameraOpen]=useState(false); const[scanPreview,setScanPreview]=useState<string|null>(null);
 const[cameraPermission,requestCameraPermission]=useCameraPermissions(); const cameraRef=useRef<CameraView>(null);
 const load=useCallback(async()=>{if(!courseId){setLoading(false);return;}setLoading(true);try{setM(await listCourseMaterials(courseId))}catch(e:any){Alert.alert('Could not load materials',e?.message??'')}finally{setLoading(false)}},[courseId]);
 useFocusEffect(useCallback(()=>{load()},[load]));

 async function publishAsset(asset:any){
   if(!courseId||!asset)return;
   const{data:u}=await supabase.auth.getUser(); if(!u.user)throw new Error('Not signed in.');
   const storage=await uploadMaterialFile(u.user.id,courseId,asset);
   const item=await createMaterial({course_id:courseId,title:title.trim(),title_ta:titleTa.trim()||null,description:null,description_ta:null,type:'pdf',storage_path:storage.path,public_url:null,file_size:storage.size,mime_type:'application/pdf',is_required:false,poll_options:null});
   setM(x=>[...x,item]); setTitle(''); setTitleTa('');
 }

 async function add(){
   if(!courseId||title.trim().length<2)return Alert.alert('Title required','Add a clear material title.');
   setBusy(true);
   try{
     if(type==='pdf'){
       const asset=await pickPdfFile();
       if(!asset)return;
       await publishAsset(asset);
     } else {
       const{data:u}=await supabase.auth.getUser(); if(!u.user)throw new Error('Not signed in.');
       let storage:any=null;
       if(type!=='poll'){const asset=await pickMaterialFile();if(!asset)return;storage=await uploadMaterialFile(u.user.id,courseId,asset);}
       const item=await createMaterial({course_id:courseId,title:title.trim(),title_ta:titleTa.trim()||null,description:null,description_ta:null,type,storage_path:storage?.path??null,public_url:null,file_size:storage?.size??null,mime_type:storage?.mimeType??null,is_required:false,poll_options:type==='poll'?poll.split('\n').map(x=>x.trim()).filter(Boolean):null});
       setM(x=>[...x,item]);setTitle('');setTitleTa('');setPoll('');
     }
     Alert.alert('Published','Only confirmed and paid learners of this course can access this material.');
   }catch(e:any){Alert.alert('Upload failed',e?.message??'Please try again.')}finally{setBusy(false)}
 }

 async function openPaperScanner(){
   if(Platform.OS==='web'){Alert.alert('Camera scan is mobile-only','Open SkillFarm on Android or iPhone to scan a paper.');return;}
   if(!cameraPermission?.granted){const result=await requestCameraPermission();if(!result.granted)return;}
   setScanPreview(null);setCameraOpen(true);
 }

 async function capturePaper(){
   try{
     const photo=await cameraRef.current?.takePictureAsync({quality:0.82,skipProcessing:true});
     if(!photo?.uri)return;
     setCameraOpen(false);setScanPreview(photo.uri);
   }catch(e:any){Alert.alert('Could not capture paper',e?.message??'Please try again.');}
 }

 async function usePaperScan(){
   if(!scanPreview||!courseId||title.trim().length<2)return;
   setBusy(true);
   try{
     const pdf=await paperPhotoToPdf(scanPreview);
     await publishAsset(pdf);
     setScanPreview(null);
     Alert.alert('Paper scan published','The camera photo was converted to a PDF. No gallery/file picker was used.');
   }catch(e:any){Alert.alert('Could not publish scan',e?.message??'Please try again.')}finally{setBusy(false)}
 }

 async function replaceFile(item:any){if(!courseId)return;try{const asset=item.type==='pdf'?await pickPdfFile():await pickMaterialFile();if(!asset)return;const{data:u}=await supabase.auth.getUser();if(!u.user)throw new Error('Not signed in.');const storage=await uploadMaterialFile(u.user.id,courseId,asset);const next=await updateMaterial(item.id,{storage_path:storage.path,file_size:storage.size,mime_type:storage.mimeType});if(item.storage_path)await deleteMaterialFile(item.storage_path);setM(x=>x.map(y=>y.id===item.id?next:y));Alert.alert('Updated','The new file is now available to eligible learners.')}catch(e:any){Alert.alert('Update failed',e?.message??'Please try again.')}}
 async function remove(item:any){Alert.alert('Delete material?',`v${item.version} will no longer be available.`,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{try{await deleteMaterial(item.id);if(item.storage_path)await deleteMaterialFile(item.storage_path);setM(x=>x.filter(y=>y.id!==item.id))}catch(e:any){Alert.alert('Could not delete',e?.message??'')}}}])}
 if(!courseId)return <View style={styles.center}><Ionicons name="folder-open-outline" size={38} color={theme.colors.border}/><Text style={styles.emptyTitle}>Choose a course first</Text><Text style={styles.emptyText}>Open Courses and tap Materials on a course to manage its files.</Text><Pressable style={[styles.add,{flex:0,paddingHorizontal:18,marginTop:14}]} onPress={()=>router.replace('/(provider)/courses')}><Text style={styles.addText}>Go to Courses</Text></Pressable></View>;
 if(loading)return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary}/></View>;
 return <>
  <ScrollView contentContainerStyle={styles.container}>
   <View style={styles.hero}><View style={styles.icon}><Ionicons name="cloud-upload-outline" size={25} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.title}>Course materials</Text><Text style={styles.sub}>Share PDFs, notes, videos or polls with approved learners. PDF uploads can also be created by scanning a paper with the camera.</Text></View></View>
   <View style={styles.card}>
    <Text style={styles.label}>Material type</Text><View style={styles.chips}>{(['pdf','note','video','poll'] as MaterialType[]).map(x=><Pressable key={x} onPress={()=>setType(x)} style={[styles.chip,type===x&&styles.active]}><Text style={[styles.chipText,type===x&&styles.activeText]}>{x==='pdf'?'PDF':x.toUpperCase()}</Text></Pressable>)}</View>
    <Text style={styles.label}>Title</Text><TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Training notes / Attendance sheet"/>
    <Text style={styles.label}>Tamil title (optional)</Text><TextInput value={titleTa} onChangeText={setTitleTa} style={styles.input} placeholder="பயிற்சி குறிப்புகள்"/>
    {type==='poll'?<><Text style={styles.label}>Poll options, one per line</Text><TextInput value={poll} onChangeText={setPoll} style={[styles.input,{minHeight:90}]} multiline placeholder={'Yes\nNo'}/></>:null}
    {type==='pdf'?<View style={styles.pdfActions}>
      <Pressable style={[styles.secondaryAction,busy&&styles.disabled]} disabled={busy} onPress={add}><Ionicons name="document-text-outline" size={18} color={theme.colors.primary}/><Text style={styles.secondaryActionText}>Upload PDF</Text></Pressable>
      <Pressable style={[styles.secondaryAction,busy&&styles.disabled]} disabled={busy} onPress={openPaperScanner}><Ionicons name="camera-outline" size={18} color={theme.colors.primary}/><Text style={styles.secondaryActionText}>Scan paper</Text></Pressable>
    </View>:<Pressable style={styles.add} disabled={busy} onPress={add}>{busy?<ActivityIndicator color="#fff"/>:<><Ionicons name={type==='poll'?'megaphone-outline':'cloud-upload-outline'} size={18} color="#fff"/><Text style={styles.addText}>{type==='poll'?'Publish poll':'Choose file'}</Text></>}</Pressable>}
    {type==='pdf'?<Text style={styles.strictNote}><Ionicons name="lock-closed-outline" size={13} color={theme.colors.primary}/> Scan paper uses camera only. Gallery and arbitrary image upload are not offered.</Text>:null}
   </View>
   <Text style={styles.section}>Published files</Text>
   {m.length===0?<View style={styles.empty}><Ionicons name="folder-open-outline" size={35} color={theme.colors.border}/><Text style={styles.emptyTitle}>No materials yet</Text><Text style={styles.emptyText}>Upload a PDF or scan a paper for your registered learners.</Text></View>:m.map(item=><View style={styles.item} key={item.id}><View style={styles.fileIcon}><Ionicons name={item.mime_type?.includes('spreadsheet')||item.mime_type==='text/csv'?'grid-outline':item.type==='video'?'play-circle-outline':item.type==='poll'?'stats-chart-outline':'document-text-outline'} size={21} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.itemTitle}>{item.title}</Text><Text style={styles.meta}>{(item.mime_type?.includes('spreadsheet')||item.mime_type==='text/csv')?'EXCEL':item.type.toUpperCase()} · v{item.version}</Text></View><View style={styles.actions}>{item.type!=='poll'?<Pressable onPress={()=>replaceFile(item)} accessibilityRole="button" accessibilityLabel="Refresh"><Ionicons name="refresh-outline" size={21} color={theme.colors.primary}/></Pressable>:null}<Pressable onPress={()=>remove(item)} accessibilityRole="button" accessibilityLabel="Delete"><Ionicons name="trash-outline" size={21} color={theme.colors.textMuted}/></Pressable></View></View>)}
  </ScrollView>

  <Modal visible={cameraOpen} animationType="slide" onRequestClose={()=>setCameraOpen(false)}>
   <View style={styles.cameraScreen}><CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
    <View style={styles.cameraOverlay}>
      <View style={styles.cameraTop}><Pressable onPress={()=>setCameraOpen(false)} style={styles.cameraClose} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color="#fff"/></Pressable><View><Text style={styles.cameraTitle}>Scan paper</Text><Text style={styles.cameraSub}>Camera only • no gallery upload</Text></View></View>
      <View style={styles.paperFrame}><View style={[styles.corner,{left:0,top:0,borderLeftWidth:4,borderTopWidth:4}]}/><View style={[styles.corner,{right:0,top:0,borderRightWidth:4,borderTopWidth:4}]}/><View style={[styles.corner,{left:0,bottom:0,borderLeftWidth:4,borderBottomWidth:4}]}/><View style={[styles.corner,{right:0,bottom:0,borderRightWidth:4,borderBottomWidth:4}]}/><Text style={styles.frameText}>Place one paper inside the frame</Text></View>
      <Pressable style={styles.capture} onPress={capturePaper}><View style={styles.captureInner}/></Pressable>
    </View>
   </View>
  </Modal>

  <Modal visible={!!scanPreview} animationType="slide" transparent onRequestClose={()=>setScanPreview(null)}>
   <View style={styles.previewBackdrop}><View style={styles.previewCard}><Text style={styles.previewTitle}>Review paper scan</Text><Text style={styles.previewSub}>Only this camera photo will be converted to a PDF.</Text>{scanPreview?<Image source={{uri:scanPreview}} style={styles.previewImage} resizeMode="contain"/>:null}<View style={styles.previewActions}><Pressable style={styles.outlineBtn} onPress={()=>{setScanPreview(null);openPaperScanner();}}><Text style={styles.outlineText}>Retake</Text></Pressable><Pressable style={styles.add} disabled={busy} onPress={usePaperScan}>{busy?<ActivityIndicator color="#fff"/>:<Text style={styles.addText}>Use scan</Text>}</Pressable></View></View></View>
  </Modal>
 </>;
}
const styles=StyleSheet.create({container:{padding:16,paddingBottom:40,backgroundColor:theme.colors.background},center:{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:theme.colors.background},hero:{flexDirection:'row',gap:12,alignItems:'center',marginBottom:14},icon:{width:48,height:48,borderRadius:16,backgroundColor:theme.colors.surfaceAlt,alignItems:'center',justifyContent:'center'},title:{fontSize:25,fontWeight:'900',color:theme.colors.text},sub:{color:theme.colors.textMuted,lineHeight:18,marginTop:4},card:{backgroundColor:theme.colors.surface,borderRadius:20,borderWidth:1,borderColor:theme.colors.border,padding:15},label:{fontSize:12,fontWeight:'800',color:theme.colors.textMuted,marginTop:10,marginBottom:6},input:{borderWidth:1,borderColor:theme.colors.border,borderRadius:12,padding:12,color:theme.colors.text,backgroundColor:theme.colors.background},chips:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{paddingHorizontal:12,paddingVertical:8,borderRadius:18,borderWidth:1,borderColor:theme.colors.border},active:{backgroundColor:theme.colors.primary,borderColor:theme.colors.primary},chipText:{fontSize:11,fontWeight:'800',color:theme.colors.textMuted},activeText:{color:'#fff'},pdfActions:{flexDirection:'row',gap:9,marginTop:14},secondaryAction:{flex:1,minHeight:50,borderRadius:13,borderWidth:1,borderColor:theme.colors.primary,backgroundColor:theme.colors.surfaceAlt,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7},secondaryActionText:{color:theme.colors.primary,fontWeight:'900'},disabled:{opacity:.5},add:{flex:1,minHeight:50,borderRadius:13,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7},addText:{color:'#fff',fontWeight:'800'},strictNote:{marginTop:10,fontSize:11,lineHeight:16,color:theme.colors.textMuted},section:{fontSize:17,fontWeight:'900',color:theme.colors.text,marginTop:20,marginBottom:8},item:{marginTop:9,padding:13,borderRadius:16,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',alignItems:'center',gap:11},fileIcon:{width:40,height:40,borderRadius:12,backgroundColor:theme.colors.background,alignItems:'center',justifyContent:'center'},itemTitle:{fontWeight:'800',color:theme.colors.text},meta:{fontSize:11,color:theme.colors.textMuted,marginTop:3},actions:{flexDirection:'row',gap:14},empty:{alignItems:'center',padding:28,borderWidth:1,borderColor:theme.colors.border,borderRadius:18,backgroundColor:theme.colors.surface},emptyTitle:{fontWeight:'900',fontSize:16,color:theme.colors.text,marginTop:8},emptyText:{color:theme.colors.textMuted,textAlign:'center',marginTop:4,lineHeight:18},cameraScreen:{flex:1,backgroundColor:'#000'},cameraOverlay:{...StyleSheet.absoluteFillObject,justifyContent:'space-between',padding:20},cameraTop:{flexDirection:'row',alignItems:'center',gap:12},cameraClose:{width:42,height:42,borderRadius:21,backgroundColor:'rgba(0,0,0,.5)',alignItems:'center',justifyContent:'center'},cameraTitle:{fontSize:18,fontWeight:'900',color:'#fff'},cameraSub:{fontSize:12,color:'#fff',marginTop:2},paperFrame:{width:'88%',height:'58%',alignSelf:'center',justifyContent:'center',alignItems:'center',borderRadius:10},corner:{position:'absolute',width:42,height:42,borderColor:theme.colors.primary},frameText:{backgroundColor:'rgba(0,0,0,.58)',color:'#fff',paddingHorizontal:12,paddingVertical:8,borderRadius:20,fontSize:13,fontWeight:'800'},capture:{alignSelf:'center',width:76,height:76,borderRadius:38,borderWidth:5,borderColor:'#fff',backgroundColor:'rgba(255,255,255,.25)',alignItems:'center',justifyContent:'center',marginBottom:20},captureInner:{width:58,height:58,borderRadius:29,backgroundColor:'#fff'},previewBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,.55)',justifyContent:'flex-end'},previewCard:{backgroundColor:theme.colors.surface,borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,minHeight:'72%'},previewTitle:{fontSize:21,fontWeight:'900',color:theme.colors.text},previewSub:{fontSize:12,color:theme.colors.textMuted,marginTop:4},previewImage:{width:'100%',height:420,marginTop:14,backgroundColor:theme.colors.background,borderRadius:14},previewActions:{flexDirection:'row',gap:10,marginTop:14},outlineBtn:{flex:1,minHeight:50,borderRadius:13,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'},outlineText:{color:theme.colors.text,fontWeight:'800'}});
