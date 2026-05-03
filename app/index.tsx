import AsyncStorage from '@react-native-async-storage/async-storage';

import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type IntervalUnit = 'days' | 'weeks' | 'months';

type ContactItem = {
  id: string;
  name: string;
  nextDue: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  context?: string;
};

const STORAGE_KEY = 'FOLLUP_APP_DATA_PIXEL_PERFECT';
const DAY_MS = 86400000;



export default function Index() {
  const [data, setData] = useState<ContactItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [nameBuf, setNameBuf] = useState('');
  const [contextBuf, setContextBuf] = useState('');
  const [unitBuf, setUnitBuf] = useState<IntervalUnit>('weeks');

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);

        if (stored) {
          setData(JSON.parse(stored));
        }
      } catch (e) {
        console.warn('Error loading data:', e);
      } finally {
        setHasLoaded(true);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (!hasLoaded) return;

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(e => {
      console.warn('Error saving data:', e);
    });
  }, [data, hasLoaded]);

  
const schedule = async (item: ContactItem) => {
  console.log(`Notification scheduling temporarily disabled for ${item.name}`);
};

  const handleSave = async (selectedVal: number, existingId?: string) => {
    if (!nameBuf.trim()) return;

    const ms =
      unitBuf === 'days'
        ? selectedVal * DAY_MS
        : unitBuf === 'weeks'
          ? selectedVal * 7 * DAY_MS
          : selectedVal * 30 * DAY_MS;

    const nextDue = Date.now() + ms;

    const newItem: ContactItem = {
      id: existingId || String(Date.now()),
      name: nameBuf.trim(),
      context: contextBuf.trim() || undefined,
      intervalValue: selectedVal,
      intervalUnit: unitBuf,
      nextDue,
    };

    setData(existingId ? data.map(i => (i.id === existingId ? newItem : i)) : [newItem, ...data]);

    await schedule(newItem);
    closeAll();
  };

  const handleFollowUp = async (item: ContactItem) => {
    const ms =
      item.intervalUnit === 'days'
        ? item.intervalValue * DAY_MS
        : item.intervalUnit === 'weeks'
          ? item.intervalValue * 7 * DAY_MS
          : item.intervalValue * 30 * DAY_MS;

    const nextDue = Date.now() + ms;
    const updated = { ...item, nextDue };

    setData(data.map(i => (i.id === item.id ? updated : i)));

    await schedule(updated);
  };

  const closeAll = () => {
    setIsAdding(false);
    setExpandedId(null);
    setConfirmDeleteId(null);
    setNameBuf('');
    setContextBuf('');
  };

  const startEdit = (item: ContactItem) => {
    setExpandedId(item.id);
    setNameBuf(item.name);
    setContextBuf(item.context || '');
    setUnitBuf(item.intervalUnit);
    setIsAdding(false);
  };

  const getNumberRange = () => {
    if (unitBuf === 'weeks') return [1, 2, 3, 4];
    if (unitBuf === 'days') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  };

  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const endOfToday = startOfToday + DAY_MS;

  const checkInList = data
    .filter(i => i.nextDue < startOfToday)
    .sort((a, b) => a.nextDue - b.nextDue);

  const todayList = data
    .filter(i => i.nextDue >= startOfToday && i.nextDue < endOfToday)
    .sort((a, b) => a.nextDue - b.nextDue);

  const upcomingList = data
    .filter(i => i.nextDue >= endOfToday)
    .sort((a, b) => a.nextDue - b.nextDue);

  const renderActiveEditor = (existingId?: string) => (
    <View key={existingId || 'new-contact'} style={[styles.card, styles.activeCard]}>
      <Text style={styles.label}>Update Entry</Text>

      <TextInput
        value={nameBuf}
        onChangeText={setNameBuf}
        style={styles.inputBold}
        placeholder="Name"
      />

      <TextInput
        value={contextBuf}
        onChangeText={setContextBuf}
        style={styles.inputContext}
        placeholder="Re: Context"
      />

      <View style={styles.divider} />

      <View style={styles.unitRow}>
        {(['days', 'weeks', 'months'] as IntervalUnit[]).map(u => (
          <TouchableOpacity
            key={u}
            onPress={() => setUnitBuf(u)}
            style={[styles.unitBtn, unitBuf === u && styles.unitBtnActive]}
          >
            <Text style={unitBuf === u ? styles.btnTextWhite : styles.btnTextDark}>
              {u}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.valRow}>
        {getNumberRange().map(v => (
          <TouchableOpacity
            key={v}
            onPress={() => handleSave(v, existingId)}
            style={styles.valBtn}
          >
            <Text style={styles.btnTextDark}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity onPress={closeAll} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCard = (item: ContactItem, status: string) => {
    if (expandedId === item.id) return renderActiveEditor(item.id);

    return (
      <View key={item.id} style={styles.card}>
        <Text style={styles.cardName}>{item.name}</Text>

        {item.context && <Text style={styles.cardContext}>Re: {item.context}</Text>}

        <Text style={styles.statusText}>{status}</Text>

        <View style={styles.primaryActionRow}>
          <TouchableOpacity onPress={() => handleFollowUp(item)} style={styles.btnTeal}>
            <Text style={styles.btnTextWhite}>Followed up</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => startEdit(item)} style={styles.btnSet}>
            <Text style={styles.btnTextDark}>Set</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.secondaryActionRow}>
          <View style={styles.editWrapper}>
            <TouchableOpacity onPress={() => startEdit(item)}>
              <Text style={styles.linkText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.deleteWrapper}>
            {confirmDeleteId === item.id ? (
              <TouchableOpacity onPress={() => setData(data.filter(i => i.id !== item.id))}>
                <Text style={styles.deleteConfirmText}>Confirm?</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setConfirmDeleteId(item.id)}>
                <Text style={styles.linkTextRed}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        {...(Platform.OS === 'android' && {
          disableScrollViewPanResponder: true,
          maintainVisibleContentPosition: { minIndexForVisible: 0 },
        })}
      >
        <Text style={styles.header}>Follup</Text>

        {!isAdding && !expandedId && (
          <TouchableOpacity onPress={() => setIsAdding(true)} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ Add Contact</Text>
          </TouchableOpacity>
        )}

        {isAdding && renderActiveEditor()}

        {checkInList.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Check In</Text>
            {checkInList.map(i => renderCard(i, 'Past due'))}
          </>
        )}

        {todayList.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Today</Text>
            {todayList.map(i => renderCard(i, 'Due today'))}
          </>
        )}

        {upcomingList.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Upcoming</Text>
            {upcomingList.map(i =>
              renderCard(i, `Follow up in ${Math.ceil((i.nextDue - Date.now()) / DAY_MS)} days`)
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1EDE5' },
  scroll: { padding: 20, paddingTop: 60, paddingBottom: 100 },
  header: { fontSize: 34, fontWeight: '900', color: '#1F2933', marginBottom: 25 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6F6A61',
    marginTop: 25,
    marginBottom: 15,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  addBtn: {
    backgroundColor: '#244C5A',
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 20,
  },
  addBtnText: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  card: {
    backgroundColor: '#FBF8F1',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    minHeight: 170,
    justifyContent: 'center',
  },
  activeCard: { borderColor: '#244C5A', borderWidth: 2, backgroundColor: '#FFF' },
  cardName: { fontSize: 28, fontWeight: '800', color: '#1F2933', lineHeight: 32 },
  cardContext: { fontSize: 18, color: '#6F6A61', fontStyle: 'italic', marginTop: 2 },
  statusText: { fontSize: 16, color: '#6F6A61', marginVertical: 8 },
  primaryActionRow: { flexDirection: 'row', gap: 12, marginTop: 5, marginBottom: 15 },
  btnTeal: {
    backgroundColor: '#244C5A',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    minWidth: 140,
    alignItems: 'center',
  },
  btnSet: {
    borderWidth: 1,
    borderColor: '#D8D1C5',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    backgroundColor: '#FFF',
    minWidth: 80,
    alignItems: 'center',
  },
  btnTextWhite: { color: '#FFF', fontWeight: '700', fontSize: 11, textAlign: 'center' },
  btnTextDark: { color: '#244C5A', fontWeight: '700', fontSize: 11, textAlign: 'center' },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2DDD4',
    paddingTop: 12,
  },
  editWrapper: { minWidth: 140, alignItems: 'flex-start', paddingLeft: 2 },
  deleteWrapper: { minWidth: 80, alignItems: 'flex-start' },
  linkText: { color: '#244C5A', fontWeight: '800', fontSize: 18 },
  linkTextRed: { color: '#9B4444', fontWeight: '800', fontSize: 18 },
  deleteConfirmText: {
    color: '#FFF',
    backgroundColor: '#9B4444',
    padding: 4,
    borderRadius: 4,
    fontWeight: '800',
    fontSize: 16,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B8B2A6',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  inputBold: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1F2933',
    borderBottomWidth: 1,
    borderColor: '#D8D1C5',
    paddingBottom: 5,
    marginBottom: 10,
  },
  inputContext: { fontSize: 18, color: '#6F6A61', fontStyle: 'italic', marginBottom: 15 },
  divider: { height: 1, backgroundColor: '#E2DDD4', marginVertical: 15 },
  unitRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  unitBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    backgroundColor: '#FBF8F1',
  },
  unitBtnActive: { backgroundColor: '#244C5A', borderColor: '#244C5A' },
  valRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  valBtn: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    minWidth: 45,
    alignItems: 'center',
  },
  cancelBtn: { marginTop: 15, padding: 5 },
  cancelText: { textAlign: 'center', color: '#6F6A61', fontWeight: '700' },
});