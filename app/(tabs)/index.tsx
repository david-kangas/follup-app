import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
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
  notificationId?: string | null;
  context?: string;
};

const STORAGE_KEY = 'FOLLOW_UP_DATA';
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const CONTEXT_LIMIT = 30;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const getMsFromInterval = (value: number, unit: IntervalUnit) => {
  if (unit === 'days') return value * DAY_MS;
  if (unit === 'weeks') return value * 7 * DAY_MS;
  return value * 30 * DAY_MS;
};

const makeSampleData = (): ContactItem[] => {
  const now = Date.now();
  return [
    { id: '1', name: 'Mike', nextDue: now, intervalValue: 1, intervalUnit: 'months', notificationId: null, context: 'coffee' },
    { id: '2', name: 'Sarah', nextDue: now + 5 * DAY_MS, intervalValue: 10, intervalUnit: 'days', notificationId: null },
    { id: '3', name: 'Chris', nextDue: now - 2 * DAY_MS, intervalValue: 2, intervalUnit: 'weeks', notificationId: null, context: 'proposal' },
  ];
};

export default function Index() {
  const [data, setData] = useState<ContactItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<IntervalUnit>('months');
  const [contextInput, setContextInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [timeOffset, setTimeOffset] = useState(0);

  const getNow = () => Date.now() + timeOffset;

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        setData(stored ? JSON.parse(stored) : makeSampleData());
      } catch {
        setData(makeSampleData());
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    const requestPermissions = async () => {
      const existing = await Notifications.getPermissionsAsync();
      if (existing.status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    };

    requestPermissions();
  }, []);

  useEffect(() => {
    if (data.length === 0) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const scheduleNotificationForItem = async (
    item: ContactItem
  ): Promise<string | null> => {
    if (item.notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(item.notificationId);
      } catch {}
    }

    const secondsUntilDue = Math.floor((item.nextDue - Date.now()) / 1000);
    if (secondsUntilDue <= 0) return null;

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Follow up',
        body: `${item.name} is due for a follow up`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilDue,
      },
    });

    return notificationId;
  };

  const resetData = async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}

    await AsyncStorage.removeItem(STORAGE_KEY);
    setData(makeSampleData());
    setEditingId(null);
    setDeletingId(null);
    setEditingNameId(null);
    setSelectedUnit('months');
    setContextInput('');
    setShowAdd(false);
    setNewName('');
    setTimeOffset(0);
  };

  const applyScheduleNow = async (
    item: ContactItem,
    intervalValue: number,
    intervalUnit: IntervalUnit,
    context?: string
  ): Promise<ContactItem> => {
    const now = getNow();

    const updated: ContactItem = {
      ...item,
      intervalValue,
      intervalUnit,
      nextDue: now + getMsFromInterval(intervalValue, intervalUnit),
      notificationId: item.notificationId ?? null,
      context: context?.trim() ? context.trim() : undefined,
    };

    updated.notificationId = await scheduleNotificationForItem(updated);
    return updated;
  };

  const handleFollowUp = async (id: string) => {
    setDeletingId(null);

    const updated = await Promise.all(
      data.map(async (item) =>
        item.id === id
          ? await applyScheduleNow(
              item,
              item.intervalValue,
              item.intervalUnit,
              item.context
            )
          : item
      )
    );

    setData(updated);
  };

  const handleSetPress = (item: ContactItem) => {
    setDeletingId(null);
    setEditingNameId(null);
    setEditingId(item.id);
    setSelectedUnit(item.intervalUnit);
    setContextInput(item.context ?? '');
  };

  const handleSetInterval = async (
    id: string,
    unit: IntervalUnit,
    value: number
  ) => {
    const updated = await Promise.all(
      data.map(async (item) =>
        item.id === id
          ? await applyScheduleNow(item, value, unit, contextInput)
          : item
      )
    );

    setData(updated);
    setEditingId(null);
    setContextInput('');
  };

  const armDeleteContact = (id: string) => {
    setEditingId(null);
    setEditingNameId(null);
    setDeletingId(id);
  };

  const cancelDelete = () => setDeletingId(null);

  const confirmDelete = async (id: string) => {
    const item = data.find((d) => d.id === id);

    if (item?.notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(item.notificationId);
      } catch {}
    }

    setData((current) => current.filter((contact) => contact.id !== id));
    setDeletingId(null);
  };

  const startEditName = (item: ContactItem) => {
    setDeletingId(null);
    setEditingId(null);
    setEditingNameId(item.id);
    setTempName(item.name);
  };

  const saveName = async (id: string) => {
    if (!tempName.trim()) return;

    const updated = await Promise.all(
      data.map(async (item) => {
        if (item.id !== id) return item;

        const renamed: ContactItem = {
          ...item,
          name: tempName.trim(),
        };

        renamed.notificationId = await scheduleNotificationForItem(renamed);
        return renamed;
      })
    );

    setData(updated);
    setEditingNameId(null);
    setTempName('');
  };

  const cancelNameEdit = () => {
    setEditingNameId(null);
    setTempName('');
  };

  const handleAddContact = async () => {
    if (!newName.trim()) return;

    const realNow = Date.now();
    const simulatedNow = getNow();

    let newContact: ContactItem = {
      id: String(realNow),
      name: newName.trim(),
      nextDue: simulatedNow,
      intervalValue: 1,
      intervalUnit: 'months',
      notificationId: null,
    };

    newContact.notificationId = await scheduleNotificationForItem(newContact);

    setData((current) => [newContact, ...current]);
    setNewName('');
    setShowAdd(false);
  };

  const sendTestNotification = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Follow up',
        body: 'This is a test notification',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 5,
      },
    });
  };

  const getDayBucket = (nextDue: number) => {
    const simulatedNow = new Date(getNow());
    const start = new Date(
      simulatedNow.getFullYear(),
      simulatedNow.getMonth(),
      simulatedNow.getDate()
    ).getTime();
    const end = start + DAY_MS;

    if (nextDue < start) return 'overdue';
    if (nextDue < end) return 'today';
    return 'upcoming';
  };

  const getStatusText = (item: ContactItem) => {
    const bucket = getDayBucket(item.nextDue);

    if (bucket === 'overdue') return 'Follow up when you can';
    if (bucket === 'today') return 'Follow up today';

    const days = Math.ceil((item.nextDue - getNow()) / DAY_MS);
    return `Follow up in ${days} day${days === 1 ? '' : 's'}`;
  };

  const sortByDue = (items: ContactItem[]) =>
    [...items].sort((a, b) => a.nextDue - b.nextDue);

  const sections = {
    overdue: sortByDue(data.filter((i) => getDayBucket(i.nextDue) === 'overdue')),
    today: sortByDue(data.filter((i) => getDayBucket(i.nextDue) === 'today')),
    upcoming: sortByDue(data.filter((i) => getDayBucket(i.nextDue) === 'upcoming')),
  };

  const getOptionsForUnit = (unit: IntervalUnit) => {
    if (unit === 'days') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (unit === 'weeks') return [1, 2, 3, 4];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  };

  const selectedContact = data.find((item) => item.id === editingId);
  const selectedOptions = getOptionsForUnit(selectedUnit);

  const closeSetSheet = () => {
    setEditingId(null);
    setContextInput('');
  };

  const renderSetSheet = () => (
    <Modal
      visible={!!editingId && !!selectedContact}
      transparent={true}
      animationType="slide"
      onRequestClose={closeSetSheet}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={closeSetSheet}
        />

        <View style={styles.setSheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Set follow up</Text>
              <Text style={styles.sheetSubtitle}>
                {selectedContact?.name}
              </Text>
            </View>

            <TouchableOpacity onPress={closeSetSheet}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.unitRow}>
            {(['days', 'weeks', 'months'] as IntervalUnit[]).map((unit) => (
              <TouchableOpacity
                key={unit}
                onPress={() => setSelectedUnit(unit)}
                style={[
                  styles.choiceButton,
                  selectedUnit === unit && styles.choiceButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.choiceButtonText,
                    selectedUnit === unit && styles.choiceButtonTextSelected,
                  ]}
                >
                  {unit}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.valueWrap}>
            {selectedOptions.map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() =>
                  selectedContact &&
                  handleSetInterval(selectedContact.id, selectedUnit, value)
                }
                style={styles.valueButton}
              >
                <Text style={styles.valueButtonText}>{value}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.contextBox}>
            <Text style={styles.contextLabel}>Re:</Text>
            <TextInput
              value={contextInput}
              onChangeText={(text) =>
                setContextInput(text.slice(0, CONTEXT_LIMIT))
              }
              placeholder="brief context"
              placeholderTextColor="#9A9489"
              style={styles.contextInput}
              maxLength={CONTEXT_LIMIT}
              returnKeyType="done"
            />
            <Text style={styles.contextCount}>
              {contextInput.length}/{CONTEXT_LIMIT}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderRow = (item: ContactItem) => (
    <View key={item.id} style={styles.card}>
      {editingNameId === item.id ? (
        <>
          <TextInput
            value={tempName}
            onChangeText={setTempName}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => saveName(item.id)}
            blurOnSubmit={true}
            autoFocus={true}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={() => saveName(item.id)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={cancelNameEdit}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.name}>{item.name}</Text>

          {item.context ? (
            <Text style={styles.contextText}>Re: {item.context}</Text>
          ) : null}

          <Text style={styles.status}>{getStatusText(item)}</Text>

          {deletingId === item.id ? (
            <View style={styles.deleteConfirmRow}>
              <TouchableOpacity
                onPress={cancelDelete}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => confirmDelete(item.id)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteButtonText}>Confirm delete</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.mainActions}>
                <TouchableOpacity
                  onPress={() => handleFollowUp(item.id)}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Followed up</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleSetPress(item)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Set</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.utilityRow}>
                <View style={styles.utilityLeft}>
                  <TouchableOpacity onPress={() => startEditName(item)}>
                    <Text style={styles.editText}>Edit</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.utilityRight}>
                  <TouchableOpacity onPress={() => armDeleteContact(item.id)}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </>
      )}
    </View>
  );

  const renderSection = (title: string, items: ContactItem[]) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map(renderRow)}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={20}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Follup</Text>

        <View style={styles.simBox}>
          <Text style={styles.simLabel}>
            Simulated now: {new Date(getNow()).toLocaleString()}
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={() => setTimeOffset((current) => current + DAY_MS)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>+1 Day</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTimeOffset((current) => current + WEEK_MS)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>+1 Week</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTimeOffset(0)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Reset Sim Time</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowAdd(!showAdd)}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>+ Add Contact</Text>
        </TouchableOpacity>

        {showAdd && (
          <View style={styles.addBox}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              style={styles.input}
              placeholder="Name"
              returnKeyType="done"
              onSubmitEditing={handleAddContact}
              blurOnSubmit={true}
              autoFocus={true}
            />
            <TouchableOpacity
              onPress={handleAddContact}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ marginBottom: 12 }}>
          <TouchableOpacity
            onPress={sendTestNotification}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Test Notification (5 sec)</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={resetData}>
          <Text style={styles.resetText}>Reset Sample Data</Text>
        </TouchableOpacity>

        {data.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Welcome to Follup</Text>
            <Text style={styles.emptySubtitle}>
              Tap + Add Contact to get started.
            </Text>
          </View>
        ) : (
          <>
            {sections.overdue.length > 0 &&
              renderSection('Reach out', sections.overdue)}
            {sections.today.length > 0 &&
              renderSection('Today', sections.today)}
            {sections.upcoming.length > 0 &&
              renderSection('Upcoming', sections.upcoming)}
          </>
        )}
      </ScrollView>

      {renderSetSheet()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F1EDE5',
  },
  container: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 16,
    color: '#1F2933',
  },

  simBox: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D8D1C5',
    borderRadius: 12,
    backgroundColor: '#FBF8F1',
  },
  simLabel: {
    marginBottom: 10,
    color: '#6F6A61',
    fontSize: 13,
  },

  addButton: {
    backgroundColor: '#244C5A',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FBF8F1',
    fontWeight: '600',
  },

  addBox: {
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#B8B2A6',
    backgroundColor: '#FBF8F1',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    color: '#1F2933',
  },

  resetText: {
    color: '#244C5A',
    marginBottom: 20,
    fontWeight: '600',
  },

  emptyState: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1F2933',
  },
  emptySubtitle: {
    color: '#6F6A61',
    fontSize: 15,
    textAlign: 'center',
  },

  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 0.5,
    color: '#6F6A61',
    marginBottom: 8,
    textTransform: 'uppercase',
  },

  card: {
    backgroundColor: '#FBF8F1',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#D8D1C5',
  },
  name: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#1F2933',
  },
  contextText: {
    color: '#6F6A61',
    marginTop: 4,
    fontSize: 14,
    fontStyle: 'italic',
  },
  status: {
    color: '#6F6A61',
    marginTop: 6,
    marginBottom: 18,
    fontSize: 14,
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  mainActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  deleteConfirmRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },

  utilityRow: {
    flexDirection: 'row',
    marginTop: 16,
    alignItems: 'center',
  },
  utilityLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  utilityRight: {
    flex: 1,
    alignItems: 'flex-start',
  },

  primaryButton: {
    backgroundColor: '#244C5A',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: '#FBF8F1',
    fontWeight: '600',
  },

  secondaryButton: {
    borderWidth: 1,
    borderColor: '#B8B2A6',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#FBF8F1',
  },
  secondaryButtonText: {
    color: '#244C5A',
    fontWeight: '600',
  },

  editText: {
    color: '#244C5A',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteText: {
    color: '#8F2D2D',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#8F2D2D',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  deleteButtonText: {
    color: '#FBF8F1',
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 41, 51, 0.35)',
  },
  setSheet: {
    backgroundColor: '#FBF8F1',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#D8D1C5',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2933',
  },
  sheetSubtitle: {
    color: '#6F6A61',
    marginTop: 4,
  },
  closeText: {
    color: '#244C5A',
    fontWeight: '600',
  },

  unitRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  choiceButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#B8B2A6',
    borderRadius: 8,
    backgroundColor: '#FBF8F1',
  },
  choiceButtonSelected: {
    backgroundColor: '#244C5A',
    borderColor: '#244C5A',
  },
  choiceButtonText: {
    color: '#1F2933',
    fontWeight: '600',
  },
  choiceButtonTextSelected: {
    color: '#FBF8F1',
  },

  valueWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  valueButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#B8B2A6',
    borderRadius: 8,
    backgroundColor: '#FBF8F1',
  },
  valueButtonText: {
    color: '#1F2933',
    fontWeight: '600',
  },

  contextBox: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2DDD4',
    paddingTop: 14,
  },
  contextLabel: {
    fontSize: 13,
    color: '#6F6A61',
    marginBottom: 6,
    fontWeight: '600',
  },
  contextInput: {
    borderWidth: 1,
    borderColor: '#B8B2A6',
    backgroundColor: '#FBF8F1',
    padding: 10,
    borderRadius: 8,
    color: '#1F2933',
  },
  contextCount: {
    color: '#6F6A61',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
});