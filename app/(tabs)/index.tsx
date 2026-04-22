import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import {
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
};

const STORAGE_KEY = 'FOLLOW_UP_DATA';
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

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
    {
      id: '1',
      name: 'Mike',
      nextDue: now,
      intervalValue: 1,
      intervalUnit: 'months',
      notificationId: null,
    },
    {
      id: '2',
      name: 'Sarah',
      nextDue: now + 5 * DAY_MS,
      intervalValue: 10,
      intervalUnit: 'days',
      notificationId: null,
    },
    {
      id: '3',
      name: 'Chris',
      nextDue: now - 2 * DAY_MS,
      intervalValue: 2,
      intervalUnit: 'weeks',
      notificationId: null,
    },
  ];
};

export default function Index() {
  const [data, setData] = useState<ContactItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  const [selectedUnit, setSelectedUnit] = useState<IntervalUnit>('months');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');

  const [timeOffset, setTimeOffset] = useState(0);

  const getNow = () => Date.now() + timeOffset;

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          setData(JSON.parse(stored));
        } else {
          setData(makeSampleData());
        }
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

    if (secondsUntilDue <= 0) {
      return null;
    }

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

    const fresh = makeSampleData();
    await AsyncStorage.removeItem(STORAGE_KEY);
    setData(fresh);
    setEditingId(null);
    setDeletingId(null);
    setEditingNameId(null);
    setSelectedUnit('months');
    setShowAdd(false);
    setNewName('');
    setTimeOffset(0);
  };

  const applyScheduleNow = async (
    item: ContactItem,
    intervalValue: number,
    intervalUnit: IntervalUnit
  ): Promise<ContactItem> => {
    const now = getNow();

    const updated: ContactItem = {
      ...item,
      intervalValue,
      intervalUnit,
      nextDue: now + getMsFromInterval(intervalValue, intervalUnit),
      notificationId: item.notificationId ?? null,
    };

    // notifications still use real-world time
    updated.notificationId = await scheduleNotificationForItem(updated);

    return updated;
  };

  const handleFollowUp = async (id: string) => {
    setDeletingId(null);

    const updated = await Promise.all(
      data.map(async (item) =>
        item.id === id
          ? await applyScheduleNow(item, item.intervalValue, item.intervalUnit)
          : item
      )
    );

    setData(updated);
  };

  const handleSetPress = (item: ContactItem) => {
    setDeletingId(null);

    if (editingId === item.id) {
      setEditingId(null);
      return;
    }

    setEditingId(item.id);
    setSelectedUnit(item.intervalUnit);
  };

  const handleSetInterval = async (
    id: string,
    unit: IntervalUnit,
    value: number
  ) => {
    const updated = await Promise.all(
      data.map(async (item) =>
        item.id === id ? await applyScheduleNow(item, value, unit) : item
      )
    );

    setData(updated);
    setEditingId(null);
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

  const sections = {
    overdue: data.filter((i) => getDayBucket(i.nextDue) === 'overdue'),
    today: data.filter((i) => getDayBucket(i.nextDue) === 'today'),
    upcoming: data.filter((i) => getDayBucket(i.nextDue) === 'upcoming'),
  };

  const getOptionsForUnit = (unit: IntervalUnit) => {
    if (unit === 'days') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (unit === 'weeks') return [1, 2, 3, 4];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  };

  const renderEditor = (item: ContactItem) => {
    if (editingId !== item.id) return null;

    const options = getOptionsForUnit(selectedUnit);

    return (
      <View style={styles.editorBox}>
        <Text style={styles.editorLabel}>Set follow up interval</Text>

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
          {options.map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => handleSetInterval(item.id, selectedUnit, value)}
              style={styles.valueButton}
            >
              <Text style={styles.valueButtonText}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderRow = (item: ContactItem) => (
    <View key={item.id} style={styles.row}>
      {editingNameId === item.id ? (
        <>
          <TextInput
            value={tempName}
            onChangeText={setTempName}
            style={styles.input}
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
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.name}</Text>
            <TouchableOpacity onPress={() => startEditName(item)}>
              <Text style={styles.icon}>✏️</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.status}>{getStatusText(item)}</Text>

          {deletingId === item.id ? (
            <View style={styles.buttonRow}>
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
                <Text style={styles.deleteButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              <TouchableOpacity
                onPress={() => handleSetPress(item)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Set</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleFollowUp(item.id)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Followed up</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => armDeleteContact(item.id)}>
                <Text style={styles.deleteIcon}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}

          {renderEditor(item)}
        </>
      )}
    </View>
  );

  const renderSection = (title: string, items: ContactItem[]) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>None</Text>
      ) : (
        items.map(renderRow)
      )}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
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

      {renderSection('Overdue', sections.overdue)}
      {renderSection('Today', sections.today)}
      {renderSection('Upcoming', sections.upcoming)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
  },

  simBox: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  simLabel: {
    marginBottom: 10,
    color: '#334155',
    fontSize: 13,
  },

  addButton: {
    backgroundColor: '#2563eb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  addButtonText: {
    color: '#fff',
  },

  addBox: {
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },

  resetText: {
    color: '#2563eb',
    marginBottom: 20,
  },

  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 18,
  },
  empty: {
    color: 'gray',
  },

  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
  },
  status: {
    color: 'gray',
    marginBottom: 6,
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },

  primaryButton: {
    backgroundColor: '#2563eb',
    padding: 8,
    borderRadius: 6,
  },
  primaryButtonText: {
    color: '#fff',
  },

  secondaryButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    padding: 8,
    borderRadius: 6,
  },
  secondaryButtonText: {
    color: '#2563eb',
  },

  deleteButton: {
    backgroundColor: '#dc2626',
    padding: 8,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#fff',
  },

  deleteIcon: {
    fontSize: 18,
    color: '#dc2626',
  },
  icon: {
    fontSize: 16,
  },

  editorBox: {
    marginTop: 10,
  },
  editorLabel: {
    fontSize: 13,
    color: 'gray',
    marginBottom: 8,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  choiceButton: {
    padding: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  choiceButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  choiceButtonText: {},
  choiceButtonTextSelected: {
    color: '#fff',
  },

  valueWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  valueButton: {
    padding: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  valueButtonText: {},
});