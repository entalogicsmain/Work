package com.entalogics.comeback.steps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class TravelLogTest {
    private val MIN = 60_000L
    private fun log() = TravelLog { Sim.UTC }
    private fun TravelLog.enter(ts: Long, t: ActivityType) = onActivity(ts, t, true)
    private fun TravelLog.exit(ts: Long, t: ActivityType) = onActivity(ts, t, false)

    /** A transition sequence as Activity Recognition delivers it: exit of one activity, enter of the next. */
    private fun TravelLog.go(ts: Long, from: ActivityType?, to: ActivityType) { if (from != null) exit(ts, from); enter(ts, to) }

    @Test fun minutesPerMode() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.WALKING)
        l.go(t0 + 10 * MIN, ActivityType.WALKING, ActivityType.STILL)
        l.go(t0 + 12 * MIN, ActivityType.STILL, ActivityType.RUNNING)
        l.go(t0 + 17 * MIN, ActivityType.RUNNING, ActivityType.STILL)
        l.go(t0 + 20 * MIN, ActivityType.STILL, ActivityType.ON_BICYCLE)
        l.go(t0 + 50 * MIN, ActivityType.ON_BICYCLE, ActivityType.STILL)
        l.go(t0 + 60 * MIN, ActivityType.STILL, ActivityType.IN_VEHICLE)
        l.go(t0 + 85 * MIN, ActivityType.IN_VEHICLE, ActivityType.WALKING)
        l.exit(t0 + 90 * MIN, ActivityType.WALKING)
        val v = l.view(t0 + 2 * 60 * MIN)["2026-10-02"]!!
        assertEquals(15, v.walkMin)          // 10 + 5
        assertEquals(5, v.runMin)
        assertEquals(30, v.bikeMin)
        assertEquals(25, v.vehicleMin)       // STILL is ignored
        assertEquals(2, v.trips.size)
        assertEquals("bike", v.trips[0].mode); assertEquals(30, v.trips[0].min)
        assertEquals("vehicle", v.trips[1].mode); assertEquals(25, v.trips[1].min)
        assertNull(v.trips[1].km)            // no location, no distance
    }

    @Test fun shortStopsDoNotSplitATrip() {
        val l = log()
        val t0 = Sim.at(17, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.go(t0 + 10 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)          // traffic light
        l.go(t0 + 12 * MIN, ActivityType.STILL, ActivityType.IN_VEHICLE)          // 2 minute stop: same trip
        l.go(t0 + 30 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        l.tick(t0 + 40 * MIN)
        val v = l.view(t0 + 41 * MIN)["2026-10-02"]!!
        assertEquals(1, v.trips.size)
        assertEquals(30, v.trips[0].min)     // door to door, stop included
        assertEquals(28, v.vehicleMin)       // the stop itself is not vehicle time
    }

    @Test fun longStopSplitsTheTrip() {
        val l = log()
        val t0 = Sim.at(17, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.go(t0 + 10 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        l.go(t0 + 13 * MIN, ActivityType.STILL, ActivityType.IN_VEHICLE)          // exactly 3 minutes: a new trip
        l.go(t0 + 25 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        val v = l.view(t0 + 40 * MIN)["2026-10-02"]!!
        assertEquals(2, v.trips.size)
        assertEquals(10, v.trips[0].min); assertEquals(12, v.trips[1].min)
    }

    @Test fun veryShortRidesAreNotTrips() {
        val l = log()
        val t0 = Sim.at(9, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.go(t0 + 90_000, ActivityType.IN_VEHICLE, ActivityType.STILL)           // 1.5 minutes
        l.tick(t0 + 10 * MIN)
        val v = l.view(t0 + 11 * MIN)["2026-10-02"]!!
        assertEquals(0, v.trips.size)
        assertEquals(2, v.vehicleMin)                                            // the time still counts (rounded)
        // but two short rides separated by a short stop make one trip of 2+ minutes
        l.enter(t0 + 11 * MIN, ActivityType.IN_VEHICLE)
        l.go(t0 + 12 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        l.enter(t0 + 13 * MIN, ActivityType.IN_VEHICLE)
        l.go(t0 + 14 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        assertEquals(1, l.view(t0 + 15 * MIN)["2026-10-02"]!!.trips.size)
    }

    @Test fun bikeAndCarAreSeparateTrips() {
        val l = log()
        val t0 = Sim.at(9, 0)
        l.enter(t0, ActivityType.ON_BICYCLE)
        l.go(t0 + 10 * MIN, ActivityType.ON_BICYCLE, ActivityType.IN_VEHICLE)      // straight into a vehicle
        l.go(t0 + 30 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        val v = l.view(t0 + 40 * MIN)["2026-10-02"]!!
        assertEquals(listOf("bike", "vehicle"), v.trips.map { it.mode })
    }

    @Test fun midnightSplitsMinutesByTimestamp() {
        val l = log()
        val t0 = Sim.at(23, 40)                                                    // 2 Oct
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.go(Sim.at(0, 20, 0, 3), ActivityType.IN_VEHICLE, ActivityType.STILL)      // 3 Oct
        val v = l.view(Sim.at(1, 0, 0, 3))
        assertEquals(20, v["2026-10-02"]!!.vehicleMin)
        assertEquals(20, v["2026-10-03"]!!.vehicleMin)
        // the trip is counted once, on the day it started
        assertEquals(1, v["2026-10-02"]!!.trips.size)
        assertEquals(40, v["2026-10-02"]!!.trips[0].min)
        assertTrue(v["2026-10-03"]!!.trips.isEmpty())
    }

    @Test fun openPeriodIsVisibleAndSplitAtMidnight() {
        val l = log()
        l.enter(Sim.at(23, 50), ActivityType.WALKING)
        val v = l.view(Sim.at(0, 10, 0, 3))
        assertEquals(10, v["2026-10-02"]!!.walkMin)
        assertEquals(10, v["2026-10-03"]!!.walkMin)
    }

    @Test fun survivesProcessDeath() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.go(t0 + 20 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        l.enter(t0 + 30 * MIN, ActivityType.IN_VEHICLE)                            // trip in progress when the process dies
        val saved = l.toJson().toString()
        val l2 = log(); l2.loadJson(org.json.JSONObject(saved))
        assertTrue(l2.tripActive)
        l2.go(t0 + 45 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        val v = l2.view(t0 + 60 * MIN)["2026-10-02"]!!
        assertEquals(35, v.vehicleMin)
        assertEquals(2, v.trips.size)                                              // 10 minute stop between: two trips
    }

    @Test fun engineForwardsTransitionsAndPersists() {
        val e = Sim.engine()
        val t0 = Sim.at(8, 0)
        e.onActivity(t0, ActivityType.WALKING, true)
        e.onActivity(t0 + 10 * MIN, ActivityType.WALKING, false)
        val e2 = Sim.engine(); e2.loadJson(e.toJson())
        assertEquals(10, e2.travelView(t0 + 20 * MIN)["2026-10-02"]!!.walkMin)
    }

    @Test fun neverTrustsAnOpenPeriodForever() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.tick(t0 + 13 * 3_600_000L)                                               // the exit event never came
        assertFalse(l.tripActive)
        assertNull(l.view(t0 + 14 * 3_600_000L)["2026-10-02"]?.takeIf { it.vehicleMin > 0 })
    }

    @Test fun tripsAreCappedPerDay() {
        val l = log()
        var t = Sim.at(0, 5)
        for (i in 0 until 70) {
            l.enter(t, ActivityType.IN_VEHICLE); l.exit(t + 3 * MIN, ActivityType.IN_VEHICLE)
            t += 10 * MIN
        }
        assertEquals(TravelLog.MAX_TRIPS_PER_DAY, l.view(t + 10 * MIN)["2026-10-02"]!!.trips.size)
    }

    // ---------- distance (tier 2) ----------
    // one degree of latitude is 111.2 km; ~0.0009 degrees is about 100 m
    private fun lat(m: Double) = 10.0 + m / 111_195.0

    @Test fun distanceIsSummedWhileTripIsActive() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        for (i in 0..60) assertTrue(l.onFix(t0 + i * 12_000L, lat(i * 200.0), 20.0, 10.0))   // 200 m per 12 s = 60 km/h for 12 minutes
        l.exit(t0 + 12 * MIN, ActivityType.IN_VEHICLE)
        val t = l.view(t0 + 20 * MIN)["2026-10-02"]!!.trips[0]
        assertEquals(12.0, t.km!!, 0.05)
        assertEquals(60.0, t.avgKmh!!, 1.0)
    }

    @Test fun fixesOutsideATripAreIgnored() {
        val l = log()
        val t0 = Sim.at(8, 0)
        assertFalse(l.onFix(t0, 10.0, 20.0, 5.0))
        l.enter(t0, ActivityType.WALKING)
        assertFalse(l.onFix(t0 + 1000, 10.0, 20.0, 5.0))
        l.go(t0 + 5 * MIN, ActivityType.WALKING, ActivityType.IN_VEHICLE)
        assertTrue(l.onFix(t0 + 5 * MIN, 10.0, 20.0, 5.0))
        l.go(t0 + 10 * MIN, ActivityType.IN_VEHICLE, ActivityType.STILL)
        assertFalse(l.onFix(t0 + 10 * MIN + 1000, 10.1, 20.0, 5.0))
    }

    @Test fun poorAccuracyAndImpossibleJumpsAreDropped() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        assertTrue(l.onFix(t0, lat(0.0), 20.0, 10.0))
        assertFalse(l.onFix(t0 + 12_000, lat(300.0), 20.0, 80.0))                   // accuracy 80 m
        assertFalse(l.onFix(t0 + 12_000, lat(50_000.0), 20.0, 10.0))                // 50 km in 12 s: a glitch
        assertTrue(l.onFix(t0 + 24_000, lat(400.0), 20.0, 10.0))                    // the road carries on from the last good fix
        l.exit(t0 + 5 * MIN, ActivityType.IN_VEHICLE)
        l.enter(t0 + 6 * MIN, ActivityType.IN_VEHICLE)                              // keep the trip (stop < 3 minutes)
        l.exit(t0 + 8 * MIN, ActivityType.IN_VEHICLE)
        val t = l.view(t0 + 20 * MIN)["2026-10-02"]!!.trips[0]
        assertEquals(0.4, t.km!!, 0.01)
    }

    @Test fun noiseWhileStoppedAddsNothing() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.onFix(t0, lat(0.0), 20.0, 30.0)
        for (i in 1..20) l.onFix(t0 + i * 12_000L, lat(if (i % 2 == 0) 6.0 else -6.0), 20.0, 30.0)  // +-6 m while accuracy is 30 m
        l.exit(t0 + 5 * MIN, ActivityType.IN_VEHICLE)
        val t = l.view(t0 + 20 * MIN)["2026-10-02"]!!.trips[0]
        assertNull(t.km)
    }

    @Test fun coordinatesAreNeverPersisted() {
        val l = log()
        val t0 = Sim.at(8, 0)
        l.enter(t0, ActivityType.IN_VEHICLE)
        l.onFix(t0, 48.123456, 11.654321, 8.0)
        l.onFix(t0 + 12_000, 48.124456, 11.654321, 8.0)
        val json = l.toJson().toString()
        assertFalse(json.contains("48.12")); assertFalse(json.contains("11.65"))
        assertFalse(json.contains("lat")); assertFalse(json.contains("lon"))
        val l2 = log(); l2.loadJson(org.json.JSONObject(json))
        assertTrue(l2.view(t0 + 20_000)["2026-10-02"]?.trips.isNullOrEmpty())             // under 2 minutes: not a trip yet
        assertNotNull(l2.view(t0 + 5 * MIN)["2026-10-02"]!!.trips.firstOrNull())
    }

    @Test fun haversineMatchesKnownDistance() {
        // Paris - London is about 343.5 km
        assertEquals(343_500.0, haversineM(48.8566, 2.3522, 51.5074, -0.1278), 1_500.0)
    }

    @Test fun dayBoundariesFollowTimeZoneChanges() {
        var z: TimeZone = Sim.UTC
        val l = TravelLog { z }
        l.enter(Sim.at(22, 0), ActivityType.WALKING)
        z = TimeZone.getTimeZone("Asia/Tokyo")                                      // UTC+9: 22:00 UTC is already 07:00 on the 3rd
        l.exit(Sim.at(22, 30), ActivityType.WALKING)
        assertEquals(30, l.view(Sim.at(23, 0))["2026-10-03"]!!.walkMin)
    }
}
